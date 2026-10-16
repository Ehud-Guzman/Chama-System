// The Control Room, end to end: what the super admin can see and do that nobody else can, and the
// rules that keep each of those powers accountable.
//
// Real endpoints, a real database. The things worth proving are the ones a screen cannot show:
// that a frozen or signed-out account really stops working on its very next request, that a
// preview cannot write, that closed books stop a treasurer but not an accountable super admin,
// that a restore refuses to run without the maintenance switch and the password, and that merging
// two members moves the money rather than losing it.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';
// Not what this file tests, and it signs in more often than a person would.
process.env.LOGIN_RATE_LIMIT_MAX = '1000';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';

// The process id is part of the name: two runs of this suite at the same time (two terminals, two people,
// a second session) each get their own database instead of dropping each other's mid-test.
const TEST_DB = `chama-rehearsal-superadmin-${process.pid}`;
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(
    `TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run. ` +
      'Name it with "rehearsal", "scratch" or "test" in it.'
  );
}

const app = require('../../src/app');
const User = require('../../src/models/User');
const Member = require('../../src/models/Member');
const Contribution = require('../../src/models/Contribution');
const ContributionType = require('../../src/models/ContributionType');
const Fine = require('../../src/models/Fine');
const FineType = require('../../src/models/FineType');
const AuditLog = require('../../src/models/AuditLog');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { writeBackupJson } = require('../../src/utils/backup');
const { toEatDateString } = require('../../src/utils/weekCycle');

const PASSWORD = 'rehearsal-password1';

let server;
let base;
let backupDir;
let superId;
let treasurerId;
let weekly;
let tokens = {};

const sign = (id, role, extra = {}) =>
  jwt.sign({ id, role, scope: 'session', ...extra }, process.env.JWT_SECRET, { expiresIn: '1h' });

const call = async (method, route, { body, token, headers } = {}) => {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})), res };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const today = () => toEatDateString(new Date());
const daysAgo = (n) => toEatDateString(new Date(Date.now() - n * 86400000));

async function setMaintenance(enabled, message = '') {
  return call('PUT', '/api/superadmin/maintenance', { token: tokens.super, body: { enabled, message } });
}

test.before(async () => {
  if (skip) return;
  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  // Dropping the database drops the unique indexes the models built when they loaded, and several
  // rules (one lease per job, one phone per member) are enforced by them. Rebuilt before any test runs.
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
  invalidateSettings();

  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chama-superadmin-'));
  process.env.BACKUP_DIR = backupDir;

  const hash = await bcrypt.hash(PASSWORD, 10);
  const make = (name, role) =>
    User.create({ name, email: `${role}@example.com`, password: hash, role, active: true });
  const sup = await make('Super Admin', 'super_admin');
  const adm = await make('Plain Admin', 'admin');
  const tre = await make('The Treasurer', 'treasurer');
  const sec = await make('The Secretary', 'secretary');
  superId = sup._id;
  treasurerId = tre._id;
  tokens = {
    super: sign(sup._id, 'super_admin'),
    admin: sign(adm._id, 'admin'),
    treasurer: sign(tre._id, 'treasurer'),
    secretary: sign(sec._id, 'secretary'),
  };

  weekly = await ContributionType.create({ name: 'Weekly contribution', isWeekly: true });

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (skip) return;
  server?.close();
  if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true });
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// --- who gets in ---------------------------------------------------------------------------------

test('the Control Room is the super admin’s: every other role is refused', { skip }, async () => {
  for (const role of ['admin', 'treasurer', 'secretary']) {
    const r = await call('GET', '/api/superadmin/overview', { token: tokens[role] });
    assert.equal(r.status, 403, role);
  }
  const ok = await call('GET', '/api/superadmin/overview', { token: tokens.super });
  assert.equal(ok.status, 200);
});

test('the overview answers with health, what needs attention, the figures and the switches', { skip }, async () => {
  const { body } = await call('GET', '/api/superadmin/overview', { token: tokens.super });
  assert.equal(body.health.database.connected, true);
  assert.ok(Array.isArray(body.attention));
  assert.ok(body.glance.members);
  assert.equal(body.controls.maintenance.enabled, false);
  assert.equal(body.controls.switches.membersAreaEnabled, true);
  assert.equal(body.health.jobs.list.length, 3);
  // A fresh database has taken no copy of the books: that is the first thing it should say.
  assert.ok(body.attention.some((item) => item.id === 'backup-never'));
});

test('the permission matrix is served from the real routes', { skip }, async () => {
  const { status, body } = await call('GET', '/api/superadmin/permissions', { token: tokens.super });
  assert.equal(status, 200);
  assert.deepEqual(body.roles, ['super_admin', 'admin', 'treasurer', 'secretary', 'disciplinary']);
  const fines = body.areas.find((a) => a.mount === '/api/fines');
  assert.equal(fines.cells.treasurer.write, false);
  assert.equal(fines.cells.admin.write, true);
});

// --- accounts ------------------------------------------------------------------------------------

test('a sign-in is booked against the account, and a wrong password is counted', { skip }, async () => {
  const bad = await call('POST', '/api/auth/login', { body: { email: 'treasurer@example.com', password: 'wrong-one-1' } });
  assert.equal(bad.status, 401);
  let user = await User.findById(treasurerId);
  assert.equal(user.failedLoginCount, 1);

  const good = await call('POST', '/api/auth/login', { body: { email: 'treasurer@example.com', password: PASSWORD } });
  assert.equal(good.status, 200);
  user = await User.findById(treasurerId);
  assert.equal(user.failedLoginCount, 0, 'a good sign-in starts the count again');
  assert.ok(user.lastLoginAt);
  assert.ok(user.lastLoginIp);

  const { body } = await call('GET', '/api/superadmin/accounts', { token: tokens.super });
  const row = body.accounts.find((a) => a.email === 'treasurer@example.com');
  assert.ok(row.lastLoginAt);
});

test('signing an account out ends its sessions on the very next request', { skip }, async () => {
  const old = sign(treasurerId, 'treasurer');
  assert.equal((await call('GET', '/api/auth/me', { token: old })).status, 200);
  await sleep(1100); // iat is whole seconds

  const out = await call('POST', `/api/superadmin/accounts/${treasurerId}/sign-out`, { token: tokens.super, body: {} });
  assert.equal(out.status, 200);
  const after = await call('GET', '/api/auth/me', { token: old });
  assert.equal(after.status, 401);
  assert.match(after.body.message, /signed out/i);

  await sleep(1100);
  const fresh = sign(treasurerId, 'treasurer');
  assert.equal((await call('GET', '/api/auth/me', { token: fresh })).status, 200, 'a new sign-in works');
  tokens.treasurer = fresh;
});

test('you cannot sign yourself out, freeze yourself or change your own role', { skip }, async () => {
  assert.equal((await call('POST', `/api/superadmin/accounts/${superId}/sign-out`, { token: tokens.super, body: {} })).status, 400);
  assert.equal(
    (await call('POST', `/api/superadmin/accounts/${superId}/freeze`, { token: tokens.super, body: { reason: 'testing' } })).status,
    400
  );
  assert.equal(
    (await call('PATCH', `/api/superadmin/accounts/${superId}/role`, { token: tokens.super, body: { role: 'admin', password: PASSWORD } })).status,
    400
  );
});

test('a frozen account stops at once, is told why, and comes back when unfrozen', { skip }, async () => {
  const noReason = await call('POST', `/api/superadmin/accounts/${treasurerId}/freeze`, { token: tokens.super, body: {} });
  assert.equal(noReason.status, 400);

  const frozen = await call('POST', `/api/superadmin/accounts/${treasurerId}/freeze`, {
    token: tokens.super,
    body: { reason: 'Receipt book is missing' },
  });
  assert.equal(frozen.status, 200);
  assert.equal(frozen.body.account.frozen, true);

  const request = await call('GET', '/api/auth/me', { token: tokens.treasurer });
  assert.equal(request.status, 401);
  assert.match(request.body.message, /frozen: Receipt book is missing/);

  const login = await call('POST', '/api/auth/login', { body: { email: 'treasurer@example.com', password: PASSWORD } });
  assert.equal(login.status, 401);
  assert.match(login.body.message, /frozen/);

  await call('POST', `/api/superadmin/accounts/${treasurerId}/unfreeze`, { token: tokens.super, body: {} });
  await sleep(1100);
  tokens.treasurer = sign(treasurerId, 'treasurer');
  assert.equal((await call('GET', '/api/auth/me', { token: tokens.treasurer })).status, 200);
});

test('changing a role needs the password, and ends the account’s old sessions', { skip }, async () => {
  const secretary = await User.findOne({ role: 'secretary' });
  const noPassword = await call('PATCH', `/api/superadmin/accounts/${secretary._id}/role`, { token: tokens.super, body: { role: 'treasurer' } });
  assert.equal(noPassword.status, 400);
  const wrong = await call('PATCH', `/api/superadmin/accounts/${secretary._id}/role`, {
    token: tokens.super,
    body: { role: 'treasurer', password: 'not-my-password1' },
  });
  // 403, never 401: a 401 on an admin page signs the user out.
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'bad_password');

  await sleep(1100);
  const done = await call('PATCH', `/api/superadmin/accounts/${secretary._id}/role`, {
    token: tokens.super,
    body: { role: 'treasurer', password: PASSWORD },
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.account.role, 'treasurer');
  // The token minted for the old role is dead.
  assert.equal((await call('GET', '/api/auth/me', { token: tokens.secretary })).status, 401);

  // And put back, so the other tests keep the roles they were written for.
  const back = await call('PATCH', `/api/superadmin/accounts/${secretary._id}/role`, {
    token: tokens.super,
    body: { role: 'secretary', password: PASSWORD },
  });
  assert.equal(back.status, 200);
  await sleep(1100);
  tokens.secretary = sign(secretary._id, 'secretary');

  const entry = await AuditLog.findOne({ entityType: 'User', entityId: secretary._id, 'after.role': 'treasurer' });
  assert.ok(entry, 'the role change is in the audit trail');
  assert.equal(entry.before.role, 'secretary');
});

// --- preview -------------------------------------------------------------------------------------

test('previewing another role is read-only and shows exactly that role’s access', { skip }, async () => {
  const started = await call('POST', '/api/superadmin/preview', { token: tokens.super, body: { role: 'treasurer' } });
  assert.equal(started.status, 200);
  const preview = started.body.token;

  const me = await call('GET', '/api/auth/me', { token: preview });
  assert.equal(me.body.user.role, 'treasurer');
  assert.equal(me.body.preview.role, 'treasurer');

  // What the treasurer can read, the preview can read...
  assert.equal((await call('GET', '/api/members', { token: preview })).status, 200);
  // ...what the treasurer cannot, it cannot — that is the point of looking.
  assert.equal((await call('GET', '/api/settings', { token: preview })).status, 403);
  assert.equal((await call('GET', '/api/fines', { token: preview })).status, 403);
  // Nothing can be written, whatever the role would allow.
  const write = await call('POST', '/api/members', { token: preview, body: { name: 'Nobody', phone: '0700000000' } });
  assert.equal(write.status, 403);
  assert.equal(write.body.code, 'preview_read_only');
  // And the Control Room is not reachable from inside a preview.
  assert.equal((await call('GET', '/api/superadmin/overview', { token: preview })).status, 403);

  // The role on the account itself was never touched.
  assert.equal((await User.findById(superId)).role, 'super_admin');
});

test('only a super admin can start a preview, and never of a super admin', { skip }, async () => {
  assert.equal((await call('POST', '/api/superadmin/preview', { token: tokens.admin, body: { role: 'treasurer' } })).status, 403);
  assert.equal((await call('POST', '/api/superadmin/preview', { token: tokens.super, body: { role: 'super_admin' } })).status, 400);
  // A forged preview claim on an ordinary account's token is refused.
  const forged = sign(treasurerId, 'treasurer', { viewAs: 'admin' });
  assert.equal((await call('GET', '/api/members', { token: forged })).status, 401);
});

// --- maintenance ---------------------------------------------------------------------------------

test('maintenance mode lets everyone read, stops everyone but the super admin writing, and says why', { skip }, async () => {
  const member = await Member.create({ name: 'Maintenance Mary', phone: '0700000101', regNumber: 'M/1', nationalId: '50000001' });
  assert.equal((await setMaintenance(true, 'Checking the March figures')).status, 200);

  const read = await call('GET', '/api/members', { token: tokens.treasurer });
  assert.equal(read.status, 200);

  const write = await call('POST', '/api/contributions', {
    token: tokens.treasurer,
    body: { memberId: member._id, typeId: weekly._id, amount: 1000, method: 'cash' },
  });
  assert.equal(write.status, 503);
  assert.equal(write.body.code, 'maintenance');
  assert.match(write.body.message, /Checking the March figures/);

  // Signing in is never blocked — the one person who must switch it off has to get in.
  const login = await call('POST', '/api/auth/login', { body: { email: 'treasurer@example.com', password: PASSWORD } });
  assert.equal(login.status, 200);

  // /me tells every screen to show the banner.
  const me = await call('GET', '/api/auth/me', { token: tokens.treasurer });
  assert.equal(me.body.maintenance.message, 'Checking the March figures');

  const superWrite = await call('POST', '/api/contributions', {
    token: tokens.super,
    body: { memberId: member._id, typeId: weekly._id, amount: 1200, method: 'cash' },
  });
  assert.equal(superWrite.status, 201, 'the super admin is not stopped');

  assert.equal((await setMaintenance(false)).status, 200);
  const after = await call('POST', '/api/contributions', {
    token: tokens.treasurer,
    body: { memberId: member._id, typeId: weekly._id, amount: 1300, method: 'cash' },
  });
  assert.equal(after.status, 201);
});

// --- closed books --------------------------------------------------------------------------------

test('closed books stop the treasurer, and let the super admin through only with a reason on record', { skip }, async () => {
  const member = await Member.create({ name: 'Locked Lucy', phone: '0700000102', regNumber: 'L/1', nationalId: '50000002' });
  const old = await Contribution.create({
    memberId: member._id,
    typeId: weekly._id,
    amount: 500,
    date: new Date(Date.now() - 20 * 86400000),
    method: 'cash',
    loggedBy: superId,
  });

  // Closing today, or a day with a missing reason, is refused.
  const future = await call('PUT', '/api/superadmin/lock', { token: tokens.super, body: { lockedThrough: today(), reason: 'no' } });
  assert.equal(future.status, 400);
  const noReason = await call('PUT', '/api/superadmin/lock', { token: tokens.super, body: { lockedThrough: daysAgo(5), reason: '' } });
  assert.equal(noReason.status, 400);

  const locked = await call('PUT', '/api/superadmin/lock', {
    token: tokens.super,
    body: { lockedThrough: daysAgo(5), reason: 'Q3 agreed at the meeting' },
  });
  assert.equal(locked.status, 200);
  assert.equal(locked.body.controls.lock.lockedThrough, daysAgo(5));

  // The treasurer cannot add, change or remove money in the closed period.
  const add = await call('POST', '/api/contributions', {
    token: tokens.treasurer,
    body: { memberId: member._id, typeId: weekly._id, amount: 700, method: 'cash', date: daysAgo(10) },
  });
  assert.equal(add.status, 423);
  assert.equal(add.body.code, 'period_locked');
  assert.equal(add.body.canOverride, false);
  assert.match(add.body.message, /Q3 agreed at the meeting/);
  assert.equal((await call('PATCH', `/api/contributions/${old._id}`, { token: tokens.treasurer, body: { amount: 600 } })).status, 423);
  assert.equal((await call('DELETE', `/api/contributions/${old._id}`, { token: tokens.treasurer })).status, 423);

  // Money dated after the lock is untouched by it.
  const open = await call('POST', '/api/contributions', {
    token: tokens.treasurer,
    body: { memberId: member._id, typeId: weekly._id, amount: 800, method: 'cash', date: daysAgo(1) },
  });
  assert.equal(open.status, 201);

  // The super admin is told it is possible, and that a reason is the price.
  const plain = await call('PATCH', `/api/contributions/${old._id}`, { token: tokens.super, body: { amount: 600 } });
  assert.equal(plain.status, 423);
  assert.equal(plain.body.canOverride, true);

  // A header that is not a reason does not count.
  const short = await call('PATCH', `/api/contributions/${old._id}`, {
    token: tokens.super,
    body: { amount: 600 },
    headers: { 'X-Override-Reason': 'ok' },
  });
  assert.equal(short.status, 423);

  // A treasurer sending the header gets nothing from it.
  const sneaky = await call('PATCH', `/api/contributions/${old._id}`, {
    token: tokens.treasurer,
    body: { amount: 600 },
    headers: { 'X-Override-Reason': encodeURIComponent('Please let me in') },
  });
  assert.equal(sneaky.status, 423);

  const reason = 'Receipt 0412 was keyed as 500, it was 600';
  const through = await call('PATCH', `/api/contributions/${old._id}`, {
    token: tokens.super,
    body: { amount: 600 },
    headers: { 'X-Override-Reason': encodeURIComponent(reason) },
  });
  assert.equal(through.status, 200);
  assert.equal((await Contribution.findById(old._id)).amount, 600);
  const trace = await AuditLog.findOne({ 'after.action': 'period-lock-override' });
  assert.ok(trace, 'the pass through the lock is in the audit trail');
  assert.equal(trace.after.reason, reason);

  // Reopened, the treasurer can work again.
  assert.equal((await call('PUT', '/api/superadmin/lock', { token: tokens.super, body: { lockedThrough: null } })).status, 200);
  assert.equal((await call('PATCH', `/api/contributions/${old._id}`, { token: tokens.treasurer, body: { amount: 650 } })).status, 200);
});

test('a week collected for everyone is held by the lock like any other money', { skip }, async () => {
  // A cycle that began three weeks ago, so week 1 has closed and is dated inside the lock.
  const Settings = require('../../src/models/Settings');
  await require('../../src/utils/ledgerTypes').seedLedgerTypes();
  await Settings.updateOne({ key: 'main' }, { $set: { weekAnchorDate: new Date(Date.now() - 21 * 86400000), cycleStartWeek: 0 } });
  invalidateSettings();

  await call('PUT', '/api/superadmin/lock', { token: tokens.super, body: { lockedThrough: daysAgo(1), reason: 'Everything so far is agreed' } });
  const blocked = await call('POST', '/api/ledger/collect-week', {
    token: tokens.treasurer,
    body: { weekNumber: 1, weeklyAmount: 1000, dryRun: false },
  });
  assert.equal(blocked.status, 423);
  assert.equal(blocked.body.code, 'period_locked');
  // Undoing one is a write to the same weeks, and is held the same way.
  assert.equal((await call('DELETE', '/api/ledger/collect-week?weekNumber=1', { token: tokens.treasurer })).status, 423);
  // A dry run writes nothing, so it is never refused.
  const dry = await call('POST', '/api/ledger/collect-week', {
    token: tokens.treasurer,
    body: { weekNumber: 1, weeklyAmount: 1000, dryRun: true },
  });
  assert.notEqual(dry.status, 423);
  await call('PUT', '/api/superadmin/lock', { token: tokens.super, body: { lockedThrough: null } });
});

test('the lock holds for spending, voided fines and ledger logs too — and not for what is dated after it', { skip }, async () => {
  const Expense = require('../../src/models/Expense');
  const member = await Member.create({ name: 'Ledger Lena', phone: '0700000103', regNumber: 'L/2', nationalId: '50000003' });
  const oldExpense = await Expense.create({
    typeId: weekly._id,
    amount: 300,
    description: 'Hall hire',
    date: new Date(Date.now() - 15 * 86400000),
    loggedBy: superId,
  });
  const fineType = await FineType.create({ name: 'Locked fine', defaultAmount: 100 });
  const oldFine = await Fine.create({
    memberId: member._id,
    typeId: fineType._id,
    amount: 100,
    remaining: 100,
    date: new Date(Date.now() - 15 * 86400000),
    issuedBy: superId,
  });

  await call('PUT', '/api/superadmin/lock', { token: tokens.super, body: { lockedThrough: daysAgo(3), reason: 'September agreed' } });

  assert.equal((await call('PATCH', `/api/expenses/${oldExpense._id}`, { token: tokens.treasurer, body: { amount: 350 } })).status, 423);
  assert.equal((await call('DELETE', `/api/expenses/${oldExpense._id}`, { token: tokens.treasurer })).status, 423);
  assert.equal((await call('DELETE', `/api/fines/${oldFine._id}`, { token: tokens.admin })).status, 423);
  const log = await call('POST', `/api/ledger/members/${member._id}/log`, {
    token: tokens.treasurer,
    body: { kind: 'contribution', amount: 700, date: daysAgo(10), method: 'cash' },
  });
  assert.equal(log.status, 423);
  assert.equal(log.body.code, 'period_locked');
  assert.equal((await Expense.findById(oldExpense._id)).amount, 300, 'nothing changed behind the refusal');
  assert.equal((await Fine.findById(oldFine._id)).deleted, false);

  // A log dated after the lock is not this rule's business (whatever else the controller says of it).
  const open = await call('POST', `/api/ledger/members/${member._id}/log`, {
    token: tokens.treasurer,
    body: { kind: 'contribution', amount: 700, date: daysAgo(1), method: 'cash' },
  });
  assert.notEqual(open.status, 423);

  // The super admin goes through with a reason, and it is recorded beside the change.
  const through = await call('DELETE', `/api/fines/${oldFine._id}`, {
    token: tokens.super,
    headers: { 'X-Override-Reason': encodeURIComponent('Fine was issued to the wrong member') },
  });
  assert.equal(through.status, 200);
  assert.ok(
    await AuditLog.findOne({ 'after.action': 'period-lock-override', 'after.reason': 'Fine was issued to the wrong member' })
  );
  await call('PUT', '/api/superadmin/lock', { token: tokens.super, body: { lockedThrough: null } });
});

// --- switches ------------------------------------------------------------------------------------

test('closing the members’ area stops members and leaves the front page and the office alone', { skip }, async () => {
  const bad = await call('PUT', '/api/superadmin/switches', { token: tokens.super, body: { membersAreaEnabled: 'no' } });
  assert.equal(bad.status, 400);
  const none = await call('PUT', '/api/superadmin/switches', { token: tokens.super, body: {} });
  assert.equal(none.status, 400);

  assert.equal((await call('PUT', '/api/superadmin/switches', { token: tokens.super, body: { membersAreaEnabled: false } })).status, 200);
  const lookup = await call('POST', '/api/public/lookup', { body: { nationalId: '50000001', phone: '0700000101' } });
  assert.equal(lookup.status, 503);
  assert.equal(lookup.body.code, 'members_area_closed');
  assert.equal((await call('GET', '/api/public/overview')).status, 200, 'the front page still loads');
  assert.equal((await call('GET', '/api/members', { token: tokens.treasurer })).status, 200, 'the office is unaffected');

  assert.equal((await call('PUT', '/api/superadmin/switches', { token: tokens.super, body: { membersAreaEnabled: true } })).status, 200);
  const open = await call('POST', '/api/public/lookup', { body: { nationalId: '50000001', phone: '0700000101' } });
  assert.notEqual(open.status, 503);
});

test('switching reminder emails off refuses a send in words a person can read', { skip }, async () => {
  await call('PUT', '/api/superadmin/switches', { token: tokens.super, body: { reminderEmailsEnabled: false } });
  const send = await call('POST', '/api/notifications/reminders', { token: tokens.treasurer, body: { memberIds: [] } });
  assert.equal(send.status, 403);
  assert.match(send.body.message, /switched off by the super admin/);
  await call('PUT', '/api/superadmin/switches', { token: tokens.super, body: { reminderEmailsEnabled: true } });
});

test('closing the constitution vote stops a member’s verdict with a plain sentence', { skip }, async () => {
  const { signMemberToken } = require('../../src/utils/memberToken');
  const voter = await Member.create({ name: 'Voting Vera', phone: '0700000104', regNumber: 'V/1', nationalId: '50000004' });
  const pass = signMemberToken(voter, { phoneVerified: true });
  const vote = () =>
    call('POST', '/api/public/constitution/decision', {
      body: { chapterNumber: 1, decision: 'approved' },
      headers: { 'X-Member-Token': pass },
    });

  await call('PUT', '/api/superadmin/switches', { token: tokens.super, body: { constitutionVotingEnabled: false } });
  const closed = await vote();
  assert.equal(closed.status, 403);
  assert.match(closed.body.message, /closed for now/);

  await call('PUT', '/api/superadmin/switches', { token: tokens.super, body: { constitutionVotingEnabled: true } });
  assert.notEqual((await vote()).status, 403, 'open again, the vote is the member’s own business');
});

test('maintenance mode stops a member’s verdict too, because it is a write', { skip }, async () => {
  const { signMemberToken } = require('../../src/utils/memberToken');
  const voter = await Member.findOne({ regNumber: 'V/1' });
  const pass = signMemberToken(voter, { phoneVerified: true });
  await setMaintenance(true, 'Redrafting');
  const res = await call('POST', '/api/public/constitution/decision', {
    body: { chapterNumber: 1, decision: 'approved' },
    headers: { 'X-Member-Token': pass },
  });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'maintenance');
  await setMaintenance(false);
});

test('the fine emails switch is read before a fine email is attempted', { skip }, async () => {
  const { announceFineIssued } = require('../../src/utils/fineEmails');
  await call('PUT', '/api/superadmin/switches', { token: tokens.super, body: { fineEmailsEnabled: false } });
  invalidateSettings();
  const member = await Member.create({
    name: 'Emailed Esther',
    phone: '0700000105',
    regNumber: 'E/1',
    nationalId: '50000005',
    email: 'esther@example.com',
  });
  const type = await FineType.findOne();
  const fine = await Fine.create({ memberId: member._id, typeId: type._id, amount: 100, remaining: 100, issuedBy: superId });
  const result = await announceFineIssued({ fine, member, performedBy: superId });
  assert.equal(result.sent, false);
  assert.match(result.reason, /switched off by the super admin/);
  await call('PUT', '/api/superadmin/switches', { token: tokens.super, body: { fineEmailsEnabled: true } });
});

test('only the super admin can move a switch', { skip }, async () => {
  for (const role of ['admin', 'treasurer']) {
    assert.equal((await call('PUT', '/api/superadmin/switches', { token: tokens[role], body: { membersAreaEnabled: false } })).status, 403);
    assert.equal((await call('PUT', '/api/superadmin/maintenance', { token: tokens[role], body: { enabled: true } })).status, 403);
    assert.equal((await call('PUT', '/api/superadmin/lock', { token: tokens[role], body: { lockedThrough: null } })).status, 403);
  }
});

// --- jobs ----------------------------------------------------------------------------------------

test('a job can be paused and resumed, and its history read', { skip }, async () => {
  const bad = await call('PUT', '/api/superadmin/jobs/no-such-job', { token: tokens.super, body: { paused: true } });
  assert.equal(bad.status, 404);
  const paused = await call('PUT', '/api/superadmin/jobs/reminder-sweep', { token: tokens.super, body: { paused: true } });
  assert.deepEqual(paused.body.controls.pausedJobs, ['reminder-sweep']);
  const { isPaused } = require('../../src/jobs');
  invalidateSettings();
  assert.equal(await isPaused('reminder-sweep'), true);
  assert.equal(await isPaused('nightly-backup'), false);
  const resumed = await call('PUT', '/api/superadmin/jobs/reminder-sweep', { token: tokens.super, body: { paused: false } });
  assert.deepEqual(resumed.body.controls.pausedJobs, []);

  const run = await call('POST', '/api/jobs/nightly-backup/run', { token: tokens.super });
  assert.equal(run.status, 200);
  const history = await call('GET', '/api/superadmin/jobs/history?name=nightly-backup', { token: tokens.super });
  assert.ok(history.body.runs.length >= 1);
  assert.equal(history.body.runs[0].ok, true);
});

// --- audit powers --------------------------------------------------------------------------------

test('the audit trail remembers where an entry came from, for the super admin’s eyes only', { skip }, async () => {
  const entry = await AuditLog.findOne({ 'after.action': 'period-lock-override' });
  assert.ok(entry.ip, 'the address was captured');

  const asSuper = await call('GET', `/api/audit?ip=${encodeURIComponent(entry.ip)}`, { token: tokens.super });
  assert.ok(asSuper.body.entries.length > 0);
  assert.ok(asSuper.body.entries.every((e) => e.ip === entry.ip));

  const asAdmin = await call('GET', '/api/audit', { token: tokens.admin });
  assert.ok(asAdmin.body.entries.length > 0);
  assert.ok(asAdmin.body.entries.every((e) => !('ip' in e)), 'the address is not handed to the office');
  // The filter is ignored for anyone else rather than leaking by its effect.
  const probe = await call('GET', '/api/audit?ip=203.0.113.99', { token: tokens.admin });
  assert.ok(probe.body.entries.length > 0);
});

test('one entry can be read raw, flagged for review, and cleared', { skip }, async () => {
  const entry = await AuditLog.findOne({ entityType: 'User', 'before.role': 'secretary', 'after.role': 'treasurer' });
  const detail = await call('GET', `/api/superadmin/audit/${entry._id}`, { token: tokens.super });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.entry.before.role, 'secretary');
  assert.equal(detail.body.entry.after.role, 'treasurer');
  assert.ok(detail.body.entry.chain.hash, 'the chain hash is shown');
  assert.equal((await call('GET', `/api/superadmin/audit/${entry._id}`, { token: tokens.admin })).status, 403);

  const flagged = await call('POST', `/api/superadmin/audit/${entry._id}/review`, {
    token: tokens.super,
    body: { status: 'flagged', note: 'Who asked for this change?' },
  });
  assert.equal(flagged.status, 201);
  assert.equal((await call('POST', `/api/superadmin/audit/${entry._id}/review`, { token: tokens.super, body: { status: 'maybe' } })).status, 400);

  const open = await call('GET', '/api/superadmin/audit-reviews', { token: tokens.super });
  assert.equal(open.body.flagged.length, 1);
  assert.equal(open.body.flagged[0].note, 'Who asked for this change?');

  const overview = await call('GET', '/api/superadmin/overview', { token: tokens.super });
  assert.equal(overview.body.audit.flaggedForReview, 1);
  assert.ok(overview.body.attention.some((a) => a.id === 'reviews-open'));

  const listed = await call('GET', '/api/audit', { token: tokens.super });
  assert.equal(listed.body.entries.find((e) => String(e._id) === String(entry._id)).review.status, 'flagged');

  await call('POST', `/api/superadmin/audit/${entry._id}/review`, { token: tokens.super, body: { status: 'cleared', note: 'It was me' } });
  const after = await call('GET', '/api/superadmin/audit-reviews', { token: tokens.super });
  assert.equal(after.body.flagged.length, 0);
  // A review never touches the chained trail.
  const verify = await call('POST', '/api/superadmin/audit-chain/verify', { token: tokens.super, body: {} });
  assert.equal(verify.body.ok, true);
});

test('the whole trail downloads in full, hashes and snapshots included', { skip }, async () => {
  const res = await fetch(`${base}/api/superadmin/export/audit`, { headers: { Authorization: `Bearer ${tokens.super}` } });
  assert.equal(res.status, 200);
  const file = await res.json();
  assert.equal(file.format, 'chama-audit-export');
  assert.equal(file.count, file.entries.length);
  assert.ok(file.entries.every((e) => e.hash || e.chainSequence == null));
  assert.equal((await fetch(`${base}/api/superadmin/export/audit`, { headers: { Authorization: `Bearer ${tokens.admin}` } })).status, 403);
});

// --- merging two members -------------------------------------------------------------------------

test('merging two records moves the money across and retires the duplicate', { skip }, async () => {
  const keep = await Member.create({ name: 'Joseph Kamau', phone: '0700000201', regNumber: 'K/1', nationalId: '60000001', openingBalance: 1000 });
  const dupe = await Member.create({ name: 'Joseph  Kamau', phone: '0700000202', regNumber: 'K/2', nationalId: '60000002', openingBalance: 2500 });
  await Contribution.create({ memberId: keep._id, typeId: weekly._id, amount: 1000, method: 'cash', loggedBy: superId });
  await Contribution.create({ memberId: dupe._id, typeId: weekly._id, amount: 1500, method: 'cash', loggedBy: superId });
  await Contribution.create({ memberId: dupe._id, typeId: weekly._id, amount: 700, method: 'cash', loggedBy: superId });
  const type = await FineType.create({ name: 'Merge fine', defaultAmount: 200 });
  await Fine.create({ memberId: dupe._id, typeId: type._id, amount: 200, remaining: 200, reason: 'late', issuedBy: superId });

  const same = await call('POST', '/api/superadmin/members/merge/preview', { token: tokens.super, body: { sourceId: keep._id, targetId: keep._id } });
  assert.equal(same.status, 400);

  const preview = await call('POST', '/api/superadmin/members/merge/preview', { token: tokens.super, body: { sourceId: dupe._id, targetId: keep._id } });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.moves.contributions.count, 2);
  assert.equal(preview.body.moves.contributions.total, 2200);
  assert.equal(preview.body.moves.fines.count, 1);
  assert.equal(preview.body.moves.fines.stillOwed, 200);
  assert.equal(preview.body.moves.openingBalance, 2500);

  const noReason = await call('POST', '/api/superadmin/members/merge', { token: tokens.super, body: { sourceId: dupe._id, targetId: keep._id, password: PASSWORD } });
  assert.equal(noReason.status, 400);
  const wrong = await call('POST', '/api/superadmin/members/merge', {
    token: tokens.super,
    body: { sourceId: dupe._id, targetId: keep._id, reason: 'Same person, two sheets', password: 'nope-nope-1' },
  });
  assert.equal(wrong.status, 403);
  assert.equal(await Contribution.countDocuments({ memberId: dupe._id }), 2, 'nothing moved on a refused merge');
  assert.equal((await call('POST', '/api/superadmin/members/merge', { token: tokens.admin, body: {} })).status, 403);

  const done = await call('POST', '/api/superadmin/members/merge', {
    token: tokens.super,
    body: { sourceId: dupe._id, targetId: keep._id, reason: 'Same person, two sheets', password: PASSWORD },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));

  assert.equal(await Contribution.countDocuments({ memberId: keep._id, deleted: false }), 3);
  assert.equal(await Contribution.countDocuments({ memberId: dupe._id }), 0);
  assert.equal(await Fine.countDocuments({ memberId: keep._id }), 1, 'his fine goes with him');
  const kept = await Member.findById(keep._id);
  const retired = await Member.findById(dupe._id);
  assert.equal(kept.openingBalance, 3500, 'his opening balances are added');
  assert.equal(retired.active, false);
  assert.equal(retired.openingBalance, 0);
  assert.match(retired.resignationReason, /merged into Joseph Kamau/);
  assert.match(kept.notes, /Same person, two sheets/);
  assert.ok(await AuditLog.findOne({ 'after.action': 'members-merged' }));
});

test('a member who left can be brought back, with a reason, and the trail keeps what the record said', { skip }, async () => {
  const gone = await Member.create({
    name: 'Returning Rose',
    phone: '0700000401',
    regNumber: 'B/1',
    nationalId: '80000001',
    active: false,
    resignedAt: new Date(Date.now() - 30 * 86400000),
    deactivatedAt: new Date(Date.now() - 30 * 86400000),
    resignationReason: 'Moved to Mombasa',
  });
  const current = await Member.create({ name: 'Current Carl', phone: '0700000402', regNumber: 'B/2', nationalId: '80000002' });
  const go = (id, body, token = tokens.super) => call('POST', `/api/superadmin/members/${id}/reinstate`, { token, body });

  assert.equal((await go(gone._id, { password: PASSWORD })).status, 400, 'a reason is required');
  assert.equal((await go(gone._id, { reason: 'She is back in Nairobi', password: 'nope-nope-1' })).status, 403);
  assert.equal((await go(current._id, { reason: 'No need at all', password: PASSWORD })).status, 400, 'already a member');
  assert.equal((await go(gone._id, { reason: 'She is back in Nairobi', password: PASSWORD }, tokens.admin)).status, 403);
  assert.equal((await Member.findById(gone._id)).active, false, 'refusals changed nothing');

  const done = await go(gone._id, { reason: 'She is back in Nairobi', password: PASSWORD });
  assert.equal(done.status, 200);
  const back = await Member.findById(gone._id);
  assert.equal(back.active, true);
  assert.equal(back.resignedAt, null);
  assert.equal(back.resignationReason, '');
  assert.match(back.notes, /Reinstated by the super admin: She is back in Nairobi \(he had left: Moved to Mombasa\)/);
  const entry = await AuditLog.findOne({ entityType: 'Member', entityId: gone._id }).sort({ createdAt: -1 });
  assert.equal(entry.before.resignationReason, 'Moved to Mombasa', 'what the record said is in the trail');
});

// --- restore -------------------------------------------------------------------------------------

async function snapshotBackupText() {
  const chunks = [];
  await writeBackupJson((chunk) => chunks.push(chunk), { exportedBy: { name: 'test' } });
  return chunks.join('');
}

async function upload(text, token = tokens.super) {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'application/json' }), 'backup.json');
  const res = await fetch(`${base}/api/superadmin/restore/inspect`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('a backup is inspected before anything is written, and the file must be a real backup', { skip }, async () => {
  const junk = await upload('{"hello": "world"}');
  assert.equal(junk.status, 400);
  assert.match(junk.body.message, /not a chama backup/);
  const empty = await fetch(`${base}/api/superadmin/restore/inspect`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.super}` } });
  assert.equal(empty.status, 400);
  assert.equal((await upload('{}', tokens.admin)).status, 403);

  const text = await snapshotBackupText();
  const seen = await upload(text);
  assert.equal(seen.status, 200);
  const members = seen.body.plan.find((row) => row.name === 'members');
  assert.equal(members.inFile, await Member.countDocuments());
  assert.equal(members.wouldReplace, members.inFile, 'every member in the file is one the database already holds');
  assert.equal(members.wouldAdd, 0);
  assert.ok(seen.body.warnings.some((w) => /Maintenance mode is off/.test(w)));
});

test('a restore needs maintenance mode, the typed word and the password — and brings back what was lost', { skip }, async () => {
  const text = await snapshotBackupText();
  const lost = await Member.create({ name: 'Lost Linda', phone: '0700000301', regNumber: 'R/1', nationalId: '70000001' });
  const text2 = await snapshotBackupText(); // includes Linda
  await Member.deleteOne({ _id: lost._id });
  assert.equal(await Member.countDocuments({ _id: lost._id }), 0);
  void text;

  const seen = await upload(text2);
  const apply = (body) => call('POST', '/api/superadmin/restore/apply', { token: tokens.super, body });
  const all = seen.body.plan.map((row) => row.name);

  // Maintenance off.
  const early = await apply({ uploadId: seen.body.uploadId, collections: ['members'], phrase: 'RESTORE', password: PASSWORD });
  assert.equal(early.status, 409);
  assert.equal(early.body.code, 'need_maintenance');

  await setMaintenance(true, 'Restoring');
  assert.equal((await apply({ uploadId: seen.body.uploadId, collections: ['members'], phrase: 'restore it', password: PASSWORD })).status, 400);
  const wrong = await apply({ uploadId: seen.body.uploadId, collections: ['members'], phrase: 'RESTORE', password: 'wrong-wrong-1' });
  assert.equal(wrong.status, 403);
  assert.equal((await apply({ uploadId: seen.body.uploadId, collections: [], phrase: 'RESTORE', password: PASSWORD })).status, 400);
  assert.equal((await apply({ uploadId: 'nope', collections: ['members'], phrase: 'RESTORE', password: PASSWORD })).status, 400);
  assert.equal(await Member.countDocuments({ _id: lost._id }), 0, 'refusals wrote nothing');

  const before = fs.readdirSync(backupDir).length;
  const done = await apply({ uploadId: seen.body.uploadId, collections: ['members'], phrase: 'RESTORE', password: PASSWORD });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.failed, 0);
  assert.ok(await Member.findById(lost._id), 'Linda is back');
  assert.ok(done.body.safetyCopy && fs.readdirSync(backupDir).length > before, 'a safety copy was written first');

  // Maintenance is still on, whatever the restored settings said.
  invalidateSettings();
  assert.equal((await getOrCreateSettings({ force: true })).maintenanceMode, true);
  // The upload is spent.
  assert.equal((await apply({ uploadId: seen.body.uploadId, collections: all, phrase: 'RESTORE', password: PASSWORD })).status, 410);

  const trace = await AuditLog.findOne({ 'after.action': 'restore-backup', 'after.via': 'control room' });
  assert.ok(trace);
  await setMaintenance(false);
});

// --- the danger zone -----------------------------------------------------------------------------

test('clearing the rehearsal’s money needs maintenance mode, a phrase and the password, and keeps everything else', { skip }, async () => {
  const members = await Member.countDocuments();
  const accounts = await User.countDocuments();
  const peek = await call('GET', '/api/superadmin/danger/preview', { token: tokens.super });
  assert.ok(peek.body.contributions > 0);

  const reset = (body) => call('POST', '/api/superadmin/danger/reset-money', { token: tokens.super, body });
  assert.equal((await reset({ phrase: 'RESET REHEARSAL DATA', password: PASSWORD })).status, 409, 'maintenance is off');

  assert.equal((await call('POST', '/api/superadmin/danger/reset-money', { token: tokens.admin, body: {} })).status, 403);

  await setMaintenance(true);
  assert.equal((await reset({ phrase: 'yes please', password: PASSWORD })).status, 400);
  assert.equal((await reset({ phrase: 'RESET REHEARSAL DATA', password: 'wrong-wrong-1' })).status, 403);
  assert.ok((await Contribution.countDocuments({ deleted: false })) > 0, 'refusals cleared nothing');

  const done = await reset({ phrase: 'RESET REHEARSAL DATA', password: PASSWORD });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.ok(done.body.contributions > 0);
  assert.ok(done.body.safetyCopy);
  assert.equal(await Contribution.countDocuments({ deleted: false }), 0);
  assert.ok((await Contribution.countDocuments({ deleted: true })) > 0, 'rows are marked, not destroyed');
  assert.equal(await Member.countDocuments(), members);
  assert.equal(await User.countDocuments(), accounts);
  assert.ok(await AuditLog.findOne({ 'after.action': 'reset-rehearsal-money' }));
  await setMaintenance(false);
});
