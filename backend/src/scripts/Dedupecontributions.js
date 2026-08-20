// One-time cleanup for contributions that were imported more than once
// (e.g. the same ledger weeks imported twice).
//
// A "duplicate group" = same memberId + typeId + amount + date (day-level),
// with more than one contribution document. For each group, the
// EARLIEST-created document is kept; every other one in that group is
// soft-deleted (deleted: true, same pattern the app already uses) and
// logged via the normal audit log so it shows up in the existing audit
// trail like any other delete.
//
// SAFE BY DEFAULT: running with no flags only prints what it WOULD delete.
// Nothing is changed until you pass --confirm-cleanup.
//
// Usage:
//   node src/scripts/dedupeContributions.js                          (dry run)
//   node src/scripts/dedupeContributions.js --confirm-cleanup        (apply)
//   node src/scripts/dedupeContributions.js --from=2026-02-01 --to=2026-08-10 --confirm-cleanup
//       (optional date range filter, inclusive, to target a specific
//        import window instead of the whole ledger)
//
// BEFORE RUNNING WITH --confirm-cleanup: take a database backup/snapshot.

require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');
const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const Contribution = require('../models/Contribution');
const { logAudit, snapshot } = require('../utils/auditLogger');

const CONFIRMED = process.argv.includes('--confirm-cleanup');
const fromArg = process.argv.find((a) => a.startsWith('--from='));
const toArg = process.argv.find((a) => a.startsWith('--to='));
const fromDate = fromArg ? new Date(fromArg.split('=')[1]) : null;
const toDate = toArg ? new Date(toArg.split('=')[1]) : null;

function dayKey(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected. Mode:', CONFIRMED ? 'APPLY (will soft-delete)' : 'DRY RUN (no changes)');

  const filter = { deleted: false };
  if (fromDate || toDate) {
    filter.date = {};
    if (fromDate) filter.date.$gte = fromDate;
    if (toDate) filter.date.$lte = toDate;
  }

  const contributions = await Contribution.find(filter).sort({ createdAt: 1 }).lean();

  const memberIds = [...new Set(contributions.map((c) => String(c.memberId)))];
  const typeIds = [...new Set(contributions.map((c) => String(c.typeId)))];
  const [members, types] = await Promise.all([
    Member.find({ _id: { $in: memberIds } }).select('name').lean(),
    ContributionType.find({ _id: { $in: typeIds } }).select('name').lean(),
  ]);
  const memberNameMap = new Map(members.map((m) => [String(m._id), m.name]));
  const typeNameMap = new Map(types.map((t) => [String(t._id), t.name]));

  console.log(`Scanning ${contributions.length} contributions in range...`);

  const groups = new Map();
  for (const c of contributions) {
    const key = [String(c.memberId), String(c.typeId), c.amount, dayKey(c.date)].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const duplicateGroups = [...groups.values()].filter((g) => g.length > 1);

  if (duplicateGroups.length === 0) {
    console.log('No duplicate groups found. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  let totalDuplicateDocs = 0;
  let totalDuplicateAmount = 0;
  const toDelete = [];

  console.log(`\nFound ${duplicateGroups.length} duplicate groups:\n`);
  for (const group of duplicateGroups) {
    // Oldest createdAt is kept (first one entered); the rest are extras.
    const [keep, ...extras] = group;
    const memberName = memberNameMap.get(String(keep.memberId)) || keep.memberId;
    const typeName = typeNameMap.get(String(keep.typeId)) || keep.typeId;
    const dateStr = new Date(keep.date).toISOString().slice(0, 10);

    console.log(
      `  ${memberName} | ${typeName} | Ksh ${keep.amount} | ${dateStr} | keeping 1, removing ${extras.length}`
    );

    for (const extra of extras) {
      toDelete.push(extra);
      totalDuplicateDocs += 1;
      totalDuplicateAmount += extra.amount;
    }
  }

  console.log(
    `\nSummary: ${totalDuplicateDocs} duplicate documents, Ksh ${totalDuplicateAmount} total, across ${duplicateGroups.length} groups.`
  );

  if (!CONFIRMED) {
    console.log('\nDRY RUN ONLY. Nothing was written. Re-run with --confirm-cleanup to actually do this.');
    await mongoose.disconnect();
    return;
  }

  const admin = await User.findOne({ role: 'super_admin' });
  if (!admin) {
    throw new Error('No super admin found — run seedSuperAdmin.js first.');
  }

  console.log('\nApplying changes...');
  let done = 0;
  for (const c of toDelete) {
    const fresh = await Contribution.findById(c._id);
    if (!fresh || fresh.deleted) continue;
    const before = snapshot(fresh);
    fresh.deleted = true;
    await fresh.save();

    try {
      await logAudit({
        action: 'delete',
        entityType: 'Contribution',
        entityId: fresh._id,
        performedBy: admin._id,
        before,
        after: snapshot(fresh),
      });
    } catch (auditErr) {
      console.warn(`  ⚠ Deleted Ksh ${fresh.amount} but audit log failed: ${auditErr.message}`);
    }

    done += 1;
    if (done % 50 === 0) console.log(`  ...${done}/${toDelete.length}`);
  }

  console.log(`\nDone. Soft-deleted ${done} duplicate contribution(s).`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});