/**
 * Read-only health check of the group's books. It writes nothing and prints no names, phone numbers or ID numbers.
 *
 * Do the figures hang together, is anything counted twice, is the audit trail whole, did the nightly backup run, is a
 * job paused, and are the security settings what the group meant. Run it any Monday, or when something looks wrong.
 *
 * Against the live database, for that one command only (the address is never written to a file):
 *
 *   MONGO_URI="<live uri>" npm run books:check
 *
 * Exit code 0 when nothing is broken (a WARN is a decision waiting for a person, not a failure), 1 when something is.
 */
require('dotenv').config();

const mongoose = require('mongoose');
// Reading a database must never build an index on it, whatever version of the code is reading.
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const AuditLog = require('../models/AuditLog');
require('../models/Member');
require('../models/Contribution');
require('../models/ContributionType');
require('../models/Fine');
require('../models/FineType');
require('../models/Expense');
require('../models/Settings');
require('../models/User');
const { listLedger } = require('../controllers/ledgerController');
const { verifyChain } = require('../utils/auditChain');

const problems = [];
const warnings = [];
const ok = (text) => console.log(`  ok    ${text}`);
const warn = (text) => {
  warnings.push(text);
  console.log(`  WARN  ${text}`);
};
const bad = (text) => {
  problems.push(text);
  console.log(`  FAIL  ${text}`);
};
const money = (n) => Number(n || 0).toLocaleString('en-KE');
const daysAgo = (date) => (Date.now() - new Date(date).getTime()) / 864e5;

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set.');
    process.exit(2);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const settings = await db.collection('settings').findOne({});
  if (!settings) {
    console.error('This database has no Settings document, so it has not been set up. Nothing to check.');
    process.exit(2);
  }
  console.log(`\nBooks check: ${settings.chamaName || 'the group'}   (${new Date().toISOString().slice(0, 16)}Z)\n`);

  // 1. The figures. The ledger is asked the way the treasurer's screen asks it.
  console.log('The figures');
  let payload;
  await listLedger({ query: {}, user: { role: 'super_admin' } }, { json: (p) => (payload = p), status() { return this; } }, (err) => {
    throw err;
  });
  const rows = payload.members || [];
  const t = payload.totals || {};
  const broken = rows.filter((m) => [m.money, m.required, m.paid, m.arrears].some((v) => !Number.isFinite(Number(v))) || m.arrears < -0.005);
  if (broken.length) bad(`${broken.length} member row(s) with a missing, non-numeric or negative figure`);
  else ok(`${rows.length} active members: every figure is a number and none owes less than nothing`);
  // He cannot owe more than the closed weeks asked for, and what he owes is at least what he is short of overall.
  const over = rows.filter((m) => m.arrears > m.required + 0.005);
  if (over.length) bad(`${over.length} member(s) owe more than the weeks that have closed asked of them`);
  else ok('nobody owes more than the closed weeks asked for');
  const short = rows.filter((m) => m.arrears + 0.005 < Math.max(0, m.required - m.paid));
  if (short.length) bad(`${short.length} member(s) owe less than they are short of overall (required less paid)`);
  else ok('what each member owes is never less than what he is short overall');
  const sumArrears = rows.reduce((a, m) => a + (m.arrears || 0), 0);
  const sumMoney = rows.reduce((a, m) => a + (m.money || 0), 0);
  if (Math.abs(sumArrears - t.arrears) > 0.01) bad(`Owed totals ${money(t.arrears)} but the member rows add to ${money(sumArrears)}`);
  else ok(`Owed in total ${money(t.arrears)}`);
  if (Math.abs(sumMoney - t.money) > 0.01) bad(`Money held totals ${money(t.money)} but the member rows add to ${money(sumMoney)}`);
  else ok(`Money held in total ${money(t.money)}`);
  if (Math.abs(t.money - t.required - t.moneyNetOfDues) > 0.01) bad('the "net of dues" total no longer equals money held less what the weeks asked for');
  else ok('money held, less what the closed weeks asked for, equals the net-of-dues figure');

  // 2. The payments.
  console.log('\nThe payments');
  const contribs = await db.collection('contributions').find({}).toArray();
  const live = contribs.filter((c) => !c.deleted);
  const memberDocs = await db.collection('members').find({}).project({ regNumber: 1, active: 1 }).toArray();
  const known = new Set(memberDocs.map((m) => String(m._id)));
  const seen = new Set();
  let repeats = 0;
  for (const c of live) {
    const key = [c.memberId, c.amount, new Date(c.date).toISOString().slice(0, 10), c.typeId].join('|');
    if (seen.has(key)) repeats += 1;
    else seen.add(key);
  }
  if (repeats) warn(`${repeats} payment(s) look like duplicates (same member, amount, day and type): check they are really two payments`);
  else ok(`${live.length} payments counted, none repeated (${contribs.length - live.length} deleted, not counted)`);
  const orphans = live.filter((c) => !known.has(String(c.memberId)));
  if (orphans.length) bad(`${orphans.length} payment(s) belong to a member who no longer exists`);
  else ok('every payment belongs to a member');
  const future = live.filter((c) => new Date(c.date) > new Date(Date.now() + 36e5));
  if (future.length) warn(`${future.length} payment(s) are dated in the future`);
  else ok('no payment is dated in the future');
  const nonPositive = live.filter((c) => !(c.amount > 0));
  if (nonPositive.length) bad(`${nonPositive.length} counted payment(s) with a zero or negative amount`);
  else ok('every counted payment is a positive amount');
  const regs = memberDocs.map((m) => m.regNumber).filter(Boolean);
  if (regs.length !== new Set(regs).size) bad('two members share a registration number');
  else ok('registration numbers are all different');

  // 3. The audit trail.
  console.log('\nThe audit trail');
  const entries = await AuditLog.find({ chainSequence: { $ne: null } })
    .sort({ chainSequence: 1 })
    .select('_id action entityType entityId performedBy before after createdAt prevHash hash chainSequence')
    .lean();
  const chain = entries.length ? verifyChain(entries) : { ok: true, verified: 0 };
  if (!chain.ok) bad(`the audit trail does not verify: ${chain.message}`);
  else ok(`${chain.verified} entries, none altered${chain.head ? `. Chain head ${String(chain.head).slice(0, 16)}... (write the full value down: npm run verify:audit)` : ''}`);

  // 4. The jobs.
  console.log('\nThe scheduled jobs');
  const paused = Array.isArray(settings.pausedJobs) ? settings.pausedJobs : [];
  for (const [name, label, staleDays] of [['nightly-backup', 'nightly backup', 2], ['audit-check', 'weekly audit check', 9]]) {
    const last = await db.collection('jobruns').find({ name }).sort({ startedAt: -1 }).limit(1).next();
    if (paused.includes(name)) warn(`the ${label} is PAUSED (Control Room, Backups, restore and jobs)`);
    if (!last) {
      if (name === 'nightly-backup') bad('no backup has ever been recorded (neither scheduled nor by hand), so the only copy of the books is the database itself. Take one now: Control Room, Backups, "Run now" on nightly-backup (see OPERATIONS.md)');
      else warn(`the ${label} has never run`);
    } else if (last.ok === false) bad(`the last ${label} FAILED (${new Date(last.startedAt).toISOString().slice(0, 16)}Z)`);
    else if (daysAgo(last.startedAt) > staleDays) warn(`the last ${label} ran ${daysAgo(last.startedAt).toFixed(0)} days ago`);
    else ok(`the last ${label} ran ${daysAgo(last.startedAt) < 1 ? 'today' : `${daysAgo(last.startedAt).toFixed(1)} days ago`}`);
  }

  // 5. Settings and accounts the group should know about.
  console.log('\nSecurity and settings');
  if (settings.maintenanceMode) warn('maintenance mode is ON: nobody but the super admin can save anything');
  else ok('maintenance mode is off');
  if (settings.passbookPhoneCheck === false) warn('the members\' phone check is OFF: an ID number alone opens a member\'s passbook (Settings)');
  else ok('a member needs his ID and his registered phone to open his passbook');
  const users = await db.collection('users').find({}).project({ role: 1, active: 1, 'twoFactor.enabled': 1 }).toArray();
  const staff = users.filter((u) => u.active !== false);
  const without2fa = staff.filter((u) => !(u.twoFactor && u.twoFactor.enabled));
  if (without2fa.length) warn(`${without2fa.length} of ${staff.length} signed-in staff accounts have no two-factor sign-in`);
  else ok(`all ${staff.length} staff accounts use two-factor sign-in`);

  await mongoose.disconnect();
  console.log('');
  if (problems.length) {
    console.log(`${problems.length} problem(s) need attention.`);
    process.exit(1);
  }
  console.log(warnings.length ? `Nothing is broken. ${warnings.length} item(s) need a person's decision.` : 'Everything checks out.');
}

main().catch(async (err) => {
  console.error('\nBooks check failed to run:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(2);
});
