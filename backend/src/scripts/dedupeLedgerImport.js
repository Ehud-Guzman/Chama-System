// One-time cleanup for the double-import found in the paper-ledger data:
// every week from the bulk import got logged TWICE — once tagged
// "(paper ledger)" and again tagged "synchronized from approved workbook"
// — landing on consecutive days, so a same-day duplicate check misses it.
//
// Rule: for each (memberId, typeId, week number extracted from the note),
// if there is a "(paper ledger)" contribution AND a "synchronized from
// approved workbook" contribution, the paper-ledger one is the duplicate
// and gets soft-deleted. The workbook version is kept — confirmed as the
// more trustworthy source.
//
// Entries that don't have a matching pair (e.g. a welfare deduction, an
// opening balance import, or a week that only exists in one source) are
// left completely alone.
//
// SAFE BY DEFAULT: dry run unless you pass --confirm-cleanup.
//
// Usage:
//   node src/scripts/dedupeLedgerImport.js                     (dry run, all members)
//   node src/scripts/dedupeLedgerImport.js --confirm-cleanup   (apply)

require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');
const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const Contribution = require('../models/Contribution');
const { logAudit, snapshot } = require('../utils/auditLogger');

const CONFIRMED = process.argv.includes('--confirm-cleanup');

const PAPER_LEDGER_RE = /\(paper ledger\)/i;
const WORKBOOK_RE = /synchronized from approved workbook/i;
const WEEK_RE = /week\s+(\d+)/i;

function extractWeek(note) {
  const m = WEEK_RE.exec(note || '');
  return m ? Number(m[1]) : null;
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected. Mode:', CONFIRMED ? 'APPLY (will soft-delete)' : 'DRY RUN (no changes)');

  const contributions = await Contribution.find({ deleted: false }).lean();
  console.log(`Scanning ${contributions.length} contributions...`);

  const memberIds = [...new Set(contributions.map((c) => String(c.memberId)))];
  const typeIds = [...new Set(contributions.map((c) => String(c.typeId)))];
  const [members, types] = await Promise.all([
    Member.find({ _id: { $in: memberIds } }).select('name').lean(),
    ContributionType.find({ _id: { $in: typeIds } }).select('name').lean(),
  ]);
  const memberNameMap = new Map(members.map((m) => [String(m._id), m.name]));
  const typeNameMap = new Map(types.map((t) => [String(t._id), t.name]));

  // Group by memberId|typeId|week, splitting each group into paper-ledger
  // entries and workbook entries.
  const groups = new Map();
  for (const c of contributions) {
    const week = extractWeek(c.note);
    if (week === null) continue; // not part of the weekly import at all
    const isPaper = PAPER_LEDGER_RE.test(c.note);
    const isWorkbook = WORKBOOK_RE.test(c.note);
    if (!isPaper && !isWorkbook) continue; // some other kind of note, skip

    const key = `${c.memberId}|${c.typeId}|${week}`;
    if (!groups.has(key)) groups.set(key, { paper: [], workbook: [] });
    const g = groups.get(key);
    if (isPaper) g.paper.push(c);
    else g.workbook.push(c);
  }

  const toDelete = [];
  let pairedGroups = 0;

  for (const [key, g] of groups) {
    if (g.paper.length === 0 || g.workbook.length === 0) continue; // no pair, leave alone
    pairedGroups += 1;
    // Normally 1 paper + 1 workbook entry per group; if either side has
    // more than one (shouldn't happen, but just in case), remove all paper
    // ones and keep all workbook ones — workbook is the trusted source.
    for (const c of g.paper) toDelete.push(c);
  }

  console.log(`\nFound ${pairedGroups} paired (member, type, week) groups with both versions.`);

  if (toDelete.length === 0) {
    console.log('Nothing to delete.');
    await mongoose.disconnect();
    return;
  }

  let totalAmount = 0;
  console.log(`\nWill remove ${toDelete.length} "(paper ledger)" entries, keeping the workbook version:\n`);
  for (const c of toDelete.slice(0, 30)) {
    const memberName = memberNameMap.get(String(c.memberId)) || c.memberId;
    const typeName = typeNameMap.get(String(c.typeId)) || c.typeId;
    const dateStr = new Date(c.date).toISOString().slice(0, 10);
    console.log(`  ${memberName} | ${typeName} | Ksh ${c.amount} | ${dateStr} | "${c.note}"`);
    totalAmount += c.amount;
  }
  if (toDelete.length > 30) {
    console.log(`  ...and ${toDelete.length - 30} more (showing first 30 only)`);
    for (const c of toDelete.slice(30)) totalAmount += c.amount;
  }

  console.log(`\nTotal amount being removed: Ksh ${totalAmount}`);

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

  console.log(`\nDone. Soft-deleted ${done} "(paper ledger)" duplicate entries.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});