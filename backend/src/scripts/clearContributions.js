/**
 * Clear the ledger's contribution rows, without touching anything else.
 *
 * `reset:week92` wipes the books *and* rolls every member's balance into his
 * opening balance — the whole fresh start, all at once. This is the narrow
 * version: the contribution rows go and nothing else moves — no member, no
 * opening balance, no fund, no settings. It exists for the case where the figures
 * the books opened with are already right and only the money logged on top of
 * them has to come off again: rows posted against a week that turned out to be
 * part of the opening balances, say.
 *
 * WHAT IT DOES
 *
 *   1. counts what is live, week by week and type by type, so the plan can be
 *      read before anything happens
 *   2. with --confirm-write: backs the rows up to backend/data/, marks them
 *      deleted (soft delete — the app never hard-deletes money), and writes one
 *      System audit entry carrying the count, the total and the member ids
 *   3. leaves expenses alone unless --expenses is passed
 *
 * Usage:
 *
 *   Dry run (the default — writes nothing):
 *     node src/scripts/clearContributions.js
 *
 *   Clear every contribution row:
 *     node src/scripts/clearContributions.js --confirm-write
 *
 *   One week only, or the expenses too:
 *     node src/scripts/clearContributions.js --week=91 --confirm-write
 *     node src/scripts/clearContributions.js --expenses --confirm-write
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Contribution = require('../models/Contribution');
const Expense = require('../models/Expense');
const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const User = require('../models/User');
const { logAudit } = require('../utils/auditLogger');
const { getOrCreateSettings } = require('../utils/settings');
const { resolveConfig, weekRange, weekNumberForDate } = require('../utils/weekCycle');

const CONFIRMED = process.argv.includes('--confirm-write');
const WITH_EXPENSES = process.argv.includes('--expenses');
// --hard deletes the rows instead of marking them. Soft delete is the app's own
// rule and stays the default; this is the exception for rows that should never
// surface anywhere again — a batch posted against a week that turned out to be
// part of the opening balances, say. The backup below still holds every field,
// and the audit entry still records the count, the total and whose money it was,
// so the trail survives even though the rows do not.
const HARD = process.argv.includes('--hard');

// Reads `--flag=value`, or null when the flag is absent or given without a value.
function argValue(flag) {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit || !hit.includes('=')) return null;
  const value = hit.slice(hit.indexOf('=') + 1).trim();
  return value === '' ? null : value;
}

const money = (n) => 'Ksh ' + Number(n || 0).toLocaleString('en-KE');

(async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 45000 });

  const settings = await getOrCreateSettings();
  const config = resolveConfig(settings);
  const week = argValue('--week') === null ? null : Number(argValue('--week'));
  if (week !== null && (!Number.isInteger(week) || week < 1)) {
    console.error('--week must be a whole number of at least 1');
    process.exit(1);
  }

  // What to touch: live rows, and — when purging — whatever was soft-deleted
  // earlier too, since the point of --hard is that the row stops existing.
  const filter = HARD ? {} : { deleted: false };
  if (week !== null) {
    const range = weekRange(week, config);
    filter.date = { $gte: range.startDate, $lte: range.endDate };
  }
  const rows = await Contribution.find(filter)
    .select('memberId typeId amount grossAmount date method note clientRequestId deleted')
    .lean();
  const expenses = WITH_EXPENSES
    ? await Expense.find({ deleted: false }).select('typeId amount date note').lean()
    : [];

  const total = rows.reduce((s, r) => s + (Number(r.grossAmount ?? r.amount) || 0), 0);
  const memberIds = [...new Set(rows.map((r) => String(r.memberId)))];
  const types = new Map((await ContributionType.find().select('name').lean()).map((t) => [String(t._id), t.name]));
  const members = new Map((await Member.find().select('name').lean()).map((m) => [String(m._id), m.name]));

  console.log(
    `\nweek cycle: start week ${config.cycleStartWeek}, weekly ${money(config.weeklyAmount)}, tea ${money(config.chaiAmount)}`
  );
  const liveCount = rows.filter((r) => !r.deleted).length;
  const alreadyCleared = rows.length - liveCount;
  console.log(
    HARD
      ? `rows to delete outright: ${rows.length} (${liveCount} live, ${alreadyCleared} already cleared), ${money(
          total
        )}, ${memberIds.length} member(s)` + (week === null ? '' : ` (week ${week} only)`)
      : `live contribution rows: ${rows.length}, ${money(total)}, ${memberIds.length} member(s)` +
          (week === null ? '' : ` (week ${week} only)`)
  );

  const byWeek = new Map();
  for (const r of rows) {
    const w = weekNumberForDate(r.date, config);
    if (!byWeek.has(w)) byWeek.set(w, { rows: 0, total: 0 });
    const e = byWeek.get(w);
    e.rows += 1;
    e.total += Number(r.grossAmount ?? r.amount) || 0;
  }
  for (const w of [...byWeek.keys()].sort((a, b) => a - b)) {
    const e = byWeek.get(w);
    console.log(`  week ${String(w).padStart(3)}: ${String(e.rows).padStart(3)} row(s), ${money(e.total)}`);
  }
  const byType = new Map();
  for (const r of rows) {
    const name = types.get(String(r.typeId)) || '(type removed)';
    const e = byType.get(name) || { rows: 0, total: 0 };
    e.rows += 1;
    e.total += Number(r.grossAmount ?? r.amount) || 0;
    byType.set(name, e);
  }
  for (const [name, e] of byType) {
    console.log(`  ${String(name).padEnd(28)} ${String(e.rows).padStart(3)} row(s), ${money(e.total)}`);
  }
  if (WITH_EXPENSES) {
    console.log(
      `  expenses too: ${expenses.length} row(s), ${money(
        expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
      )}`
    );
  }

  if (rows.length === 0 && expenses.length === 0) {
    console.log('\nNothing live to clear.');
    await mongoose.disconnect();
    return;
  }
  if (!CONFIRMED) {
    console.log(
      '\nDRY RUN — nothing written. The rows are marked deleted (soft delete), so every\n' +
        'screen and total drops them while the record itself stays for the audit trail.'
    );
    console.log('Re-run with --confirm-write to clear them.');
    await mongoose.disconnect();
    return;
  }

  // A copy before a single row moves, the same promise every destructive script
  // here makes.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.resolve(__dirname, '../../data', `contributions-cleared-${stamp}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ takenAt: new Date().toISOString(), week, rows, expenses })
  );
  console.log(`\nbackup written: ${backupPath}`);

  const admin = await User.findOne({ role: 'super_admin' }).lean();
  if (!admin) {
    console.error('No super admin to attribute the change to — aborting without writing.');
    process.exit(1);
  }

  const res = HARD
    ? { deletedCount: (await Contribution.deleteMany(filter)).deletedCount }
    : { modifiedCount: (await Contribution.updateMany(filter, { $set: { deleted: true } })).modifiedCount };
  const removed = res.deletedCount ?? res.modifiedCount;
  console.log(`${HARD ? 'deleted outright' : 'cleared'} ${removed} contribution row(s).`);
  let removedExpenses = 0;
  if (WITH_EXPENSES) {
    const exp = await Expense.updateMany({ deleted: false }, { $set: { deleted: true } });
    removedExpenses = exp.modifiedCount;
    console.log(`cleared ${removedExpenses} expense row(s).`);
  }

  // One entry for the whole action, like the reset and the bulk week post: a
  // group-wide maintenance action belongs to the System entity, and the summary
  // carries the member ids and the total so the trail is whole.
  await logAudit({
    action: 'delete',
    entityType: 'System',
    entityId: settings._id,
    performedBy: admin._id,
    before: {
      action: 'clear-contributions',
      script: 'src/scripts/clearContributions.js',
      week,
      removed,
      removedExpenses,
      total,
      memberIds,
      members: memberIds.map((id) => members.get(id) || id),
    },
  });

  console.log('\nDone. Members, opening balances, funds and settings are untouched.');
  console.log('Open /admin/finance — the header and every member total recompute from what is left.');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('\nCLEAR FAILED:', err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
