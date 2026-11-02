/**
 * Start the books again from the paper register: wipe the logged money and make each
 * member's opening balance the figure the paper sheet carries.
 *
 * It exists for the day the system and the paper register stop tallying and the group
 * decides the paper is right. The sheet's PREVIOUS column is what every member holds
 * once a week's collection is in, with the week's tea already taken off, so it is
 * exactly what the engine calls an opening balance — and the week it was taken at has
 * to become the cycle's opening (baseline) week, or the engine would charge the weeks
 * between the old anchor and now a second time on top of figures that already include
 * them.
 *
 * WHAT IT DOES
 *
 *   1. reads the sheet (--sheet=, default data/paper-sheet-week98.json) and matches
 *      each name to a member; an unmatched name or an active member missing from the
 *      sheet stops everything before anything is written
 *   2. moves the cycle: cycleStartWeek = the sheet's week, the anchor = that week's
 *      Friday (worked out from the current anchor, so it cannot be mistyped), and the
 *      money line = the sheet's header figure as at that week
 *   3. sets every member's opening balance to his sheet figure and empties his
 *      fineDebits (fines taken out of his balance would otherwise be subtracted a
 *      second time from a figure that is already net of them)
 *   4. soft-deletes every contribution row and every fine (expenses are left alone)
 *   5. sets the Tea, Registration and Resignation funds so each one READS its sheet
 *      figure (opening = sheet + the expenses already charged to it). The Fines fund
 *      is deliberately not touched.
 *   6. re-reads every member through the ledger engine and fails loudly if any figure
 *      differs from the sheet
 *
 * Nothing is written without --confirm-write. A full copy of everything it is about
 * to change goes to backend/data/ first, and each change is audit-logged.
 *
 *   Dry run (the default):
 *     node src/scripts/resetToPaperSheet.js
 *   Apply:
 *     node src/scripts/resetToPaperSheet.js --confirm-write
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const Expense = require('../models/Expense');
const Fine = require('../models/Fine');
const Settings = require('../models/Settings');
const User = require('../models/User');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { invalidateSettings } = require('../utils/settings');
const { memberLedgerNow } = require('../utils/memberMoney');
const { resolveConfig, weekRange, currentWeekNumber } = require('../utils/weekCycle');

const CONFIRMED = process.argv.includes('--confirm-write');

// Reads `--flag=value`, or null when the flag is absent or given without a value.
function argValue(flag) {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit || !hit.includes('=')) return null;
  const value = hit.slice(hit.indexOf('=') + 1).trim();
  return value === '' ? null : value;
}

const money = (n) => 'Ksh ' + Number(n || 0).toLocaleString('en-KE');
const key = (name) => String(name).trim().replace(/\s+/g, ' ').toLowerCase();
const fail = (msg) => {
  console.error(`\n${msg}`);
  process.exit(1);
};

(async () => {
  if (!process.env.MONGO_URI) fail('MONGO_URI is not set. Copy .env.example to .env and fill it in.');

  const sheetPath = path.resolve(process.cwd(), argValue('--sheet') || 'data/paper-sheet-week98.json');
  if (!fs.existsSync(sheetPath)) fail(`No such sheet: ${sheetPath}`);
  const sheet = JSON.parse(fs.readFileSync(sheetPath, 'utf8'));

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 45000 });
  console.log(`Database: "${mongoose.connection.db.databaseName}"`);

  const settings = await Settings.findOne({ key: 'main' });
  if (!settings || !settings.weekAnchorDate) fail('No Settings row with a week anchor.');
  const oldConfig = resolveConfig(settings);
  const nowWeek = currentWeekNumber(oldConfig);

  // The week the sheet closes. It must not be a week that has not happened yet.
  const week = Number(sheet.week);
  if (!Number.isInteger(week) || week < oldConfig.cycleStartWeek || week > nowWeek) {
    fail(`Sheet week ${sheet.week} is outside ${oldConfig.cycleStartWeek}..${nowWeek} (the live cycle).`);
  }
  const newAnchor = weekRange(week, oldConfig).startDate;

  // This script writes straight to the database, so it goes round the period lock that stops the
  // office. Closed books are the committee's agreed figures: rewriting them has to be said out loud.
  const lockedThrough = settings.lockedThrough ? new Date(settings.lockedThrough) : null;
  if (lockedThrough) {
    const day = lockedThrough.toISOString().slice(0, 10);
    if (!process.argv.includes('--override-lock')) {
      fail(
        `The books are closed through ${day}${settings.lockReason ? ` (${settings.lockReason})` : ''}.\n` +
          'This reset rewrites every balance, so it will not run until you add --override-lock.'
      );
    }
    console.log(`NOTE: the books are closed through ${day}; --override-lock given, going round the lock.`);
  }

  const members = await Member.find().sort({ name: 1 }).lean();
  const byName = new Map(members.map((m) => [key(m.name), m]));
  const plan = [];
  for (const [name, amount] of Object.entries(sheet.members)) {
    const m = byName.get(key(name));
    if (!m) fail(`"${name}" on the sheet matches no member.`);
    if (!Number.isFinite(amount) || amount < 0) fail(`"${name}": ${amount} is not an amount.`);
    plan.push({ member: m, amount });
  }
  const onSheet = new Set(plan.map((p) => String(p.member._id)));
  const missing = members.filter((m) => !onSheet.has(String(m._id)));
  const missingActive = missing.filter((m) => m.active !== false);
  if (missingActive.length) fail(`Active member(s) not on the sheet: ${missingActive.map((m) => m.name).join(', ')}`);

  // Fund targets: opening = sheet figure + what has already been spent from the fund,
  // because a fund's balance reads opening + collected + automatic tea − spent, and the
  // wipe and the new anchor take collected and automatic tea back to zero.
  const types = await ContributionType.find().lean();
  const spent = new Map(
    (await Expense.aggregate([{ $match: { deleted: false } }, { $group: { _id: '$typeId', total: { $sum: '$amount' } } }])).map(
      (r) => [String(r._id), r.total]
    )
  );
  const fundPlan = [];
  for (const [name, target] of Object.entries(sheet.funds || {})) {
    const t = types.find((x) => key(x.name) === key(name));
    if (!t) fail(`Fund "${name}" on the sheet matches no contribution type.`);
    const out = spent.get(String(t._id)) || 0;
    fundPlan.push({ type: t, target, spent: out, opening: target + out });
  }

  const liveRows = await Contribution.countDocuments({ deleted: false });
  const liveFines = await Fine.countDocuments({ deleted: false });
  const debitCount = members.reduce((s, m) => s + (m.fineDebits || []).length, 0);

  console.log(`\ncycle: start week ${oldConfig.cycleStartWeek} -> ${week}, anchor ${oldConfig.anchorDate.toISOString()} -> ${newAnchor.toISOString()}`);
  console.log(`current week stays ${nowWeek}; money line ${money(settings.reminderMoneyLimit)} -> ${money(sheet.moneyLine)} as at week ${week}`);
  console.log('\n  ' + 'MEMBER'.padEnd(22) + 'OPENING NOW'.padStart(14) + 'SHEET'.padStart(14) + 'CHANGE'.padStart(12) + '  fineDebits');
  let totalNow = 0;
  let totalSheet = 0;
  for (const { member, amount } of plan) {
    const now = Number(member.openingBalance) || 0;
    totalNow += now;
    totalSheet += amount;
    const inactive = member.active === false ? '  (inactive, stays inactive)' : '';
    console.log(
      '  ' + String(member.name).padEnd(22) + money(now).padStart(14) + money(amount).padStart(14) +
        ((amount - now >= 0 ? '+' : '') + (amount - now)).padStart(12) + `  ${(member.fineDebits || []).length}` + inactive
    );
  }
  console.log('  ' + 'TOTAL'.padEnd(22) + money(totalNow).padStart(14) + money(totalSheet).padStart(14));
  if (missing.length) console.log(`  left alone (not on sheet, inactive): ${missing.map((m) => m.name).join(', ')}`);
  console.log('\nfunds (balance reads the sheet figure):');
  for (const f of fundPlan) {
    console.log(`  ${f.type.name.padEnd(22)} opening ${money(f.type.openingBalance)} -> ${money(f.opening)} (sheet ${money(f.target)}, spent from it ${money(f.spent)})`);
  }
  console.log('  Fines & Penalties      left as it is');
  console.log(`\nto clear: ${liveRows} contribution row(s), ${liveFines} fine(s) voided, ${debitCount} fine debit(s) on members`);

  if (!CONFIRMED) {
    console.log('\nDRY RUN — nothing written. Re-run with --confirm-write to apply.');
    await mongoose.disconnect();
    return;
  }

  const admin = await User.findOne({ role: 'super_admin' }).lean();
  if (!admin) fail('No super admin to attribute the change to — aborting without writing.');

  // A copy of everything about to change, before the first write.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.resolve(__dirname, '../../data', `reset-to-paper-sheet-${stamp}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(
    backupPath,
    JSON.stringify({
      takenAt: new Date().toISOString(),
      settings: settings.toObject(),
      members,
      types,
      contributions: await Contribution.find({ deleted: false }).lean(),
      fines: await Fine.find({ deleted: false }).lean(),
    })
  );
  console.log(`\nbackup written: ${backupPath}`);

  const beforeSettings = snapshot(settings);
  const updatedSettings = await Settings.findOneAndUpdate(
    { key: 'main' },
    {
      $set: {
        cycleStartWeek: week,
        weekAnchorDate: newAnchor,
        reminderMoneyLimit: sheet.moneyLine,
        reminderMoneyLimitWeek: week,
        updatedBy: admin._id,
      },
    },
    { new: true }
  );
  invalidateSettings();
  await logAudit({
    action: 'update',
    entityType: 'Settings',
    entityId: updatedSettings._id,
    performedBy: admin._id,
    before: beforeSettings,
    after: snapshot(updatedSettings),
  });

  const rows = await Contribution.updateMany({ deleted: false }, { $set: { deleted: true } });
  const fines = await Fine.updateMany({ deleted: false }, { $set: { deleted: true } });
  console.log(`cleared ${rows.modifiedCount} contribution row(s); voided ${fines.modifiedCount} fine(s).`);

  for (const { member, amount } of plan) {
    const updated = await Member.findByIdAndUpdate(
      member._id,
      { $set: { openingBalance: amount, fineDebits: [] } },
      { new: true }
    );
    await logAudit({
      action: 'update',
      entityType: 'Member',
      entityId: updated._id,
      performedBy: admin._id,
      before: member,
      after: { ...snapshot(updated), restoredBy: 'src/scripts/resetToPaperSheet.js' },
    });
  }
  for (const f of fundPlan) {
    const updated = await ContributionType.findByIdAndUpdate(f.type._id, { $set: { openingBalance: f.opening } }, { new: true });
    await logAudit({
      action: 'update',
      entityType: 'ContributionType',
      entityId: updated._id,
      performedBy: admin._id,
      before: f.type,
      after: snapshot(updated),
    });
  }
  await logAudit({
    action: 'delete',
    entityType: 'System',
    entityId: updatedSettings._id,
    performedBy: admin._id,
    before: {
      action: 'reset-to-paper-sheet',
      script: 'src/scripts/resetToPaperSheet.js',
      week,
      contributionsCleared: rows.modifiedCount,
      finesVoided: fines.modifiedCount,
      fineDebitsCleared: debitCount,
      membersSet: plan.length,
      total: totalSheet,
      overrodeLockThrough: lockedThrough ? lockedThrough.toISOString() : null,
    },
  });

  // Read every member back through the engine. This is the check that the anchor and the
  // opening balances agree: any drift here means the figures would show wrong in the app.
  invalidateSettings();
  let wrong = 0;
  for (const { member, amount } of plan) {
    const ledger = await memberLedgerNow(member._id);
    if (Math.round(ledger.money * 100) !== Math.round(amount * 100)) {
      wrong += 1;
      console.error(`MISMATCH ${member.name}: ledger reads ${money(ledger.money)}, sheet says ${money(amount)}`);
    }
  }
  if (wrong) fail(`${wrong} member(s) do not read their sheet figure — see above. The backup is at ${backupPath}.`);
  console.log(`\nverified: all ${plan.length} members read exactly their sheet figure (${money(totalSheet)} between them).`);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('\nRESET FAILED:', err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
