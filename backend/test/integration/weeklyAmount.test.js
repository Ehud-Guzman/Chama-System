// Raising the weekly contribution, end to end through the API.
//
// The weekly amount used to be one number, so changing it rewrote history. It is now a dated change that
// applies from its own week onward. What this holds, against a real database:
//   - a preview says what the line will be without saving anything;
//   - weeks that have closed cannot be touched, and nonsense is refused;
//   - a rise changes nothing that has already happened: the closed weeks, the arrears and the line this week;
//   - a change can be replaced or taken back until its week closes, every one is audited, and closed books hold it;
//   - the opening amount cannot be overwritten once a week has been asked at it.
//
// Needs a scratch MongoDB — see the note at the top of ledger.test.js. It creates and drops its own database
// and refuses a URI that does not look like a scratch one.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of ledger.test.js)';

const TEST_DB = 'chama-rehearsal-weeklyamount';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(`TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run.`);
}

const app = require('../../src/app');
const Member = require('../../src/models/Member');
const User = require('../../src/models/User');
const Settings = require('../../src/models/Settings');
const AuditLog = require('../../src/models/AuditLog');
const Contribution = require('../../src/models/Contribution');
const ContributionType = require('../../src/models/ContributionType');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds, WEEKLY_TYPE_NAME } = require('../../src/utils/ledgerTypes');
const { resolveConfig, fridayOf, weekRange, currentWeekNumber } = require('../../src/utils/weekCycle');

let server;
let base;
let tokens;
let steady; // pays every week in full
let config;
let current;

const api = (method, route, { token, body, headers } = {}) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));

const changes = async () => (await Settings.findOne({ key: 'main' }).lean()).weeklyAmountChanges || [];
const raise = (fromWeek, amount, extra = {}) =>
  api('POST', '/api/ledger/weekly-amount', { token: tokens.treasurer, body: { fromWeek, amount, ...extra } });
const clear = async () => {
  await Settings.updateOne({ key: 'main' }, { $set: { weeklyAmountChanges: [], lockedThrough: null, lockReason: '' } });
  invalidateSettings();
};
const ledgerOf = async (member) => (await api('GET', `/api/ledger/members/${member._id}`, { token: tokens.treasurer })).body;

test.before(async () => {
  if (skip) return;
  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  // The cycle opened in week 92, seven weeks ago, so "now" is week 99 and weeks 93-98 have closed.
  const settings = await getOrCreateSettings();
  settings.cycleStartWeek = 92;
  settings.weeklyAmount = 1500;
  settings.chaiAmount = 100;
  settings.weekAnchorDate = fridayOf(new Date(Date.now() - 49 * 86400000));
  await settings.save();
  invalidateSettings();
  await seedLedgerTypes();
  await seedGroupFunds();
  config = resolveConfig(await getOrCreateSettings());
  current = currentWeekNumber(config);
  assert.equal(current, 99, 'the fixture puts the group in week 99');

  steady = await Member.create({ name: 'Steady Payer', phone: '0712000051', regNumber: 'W/001', openingBalance: 130000 });
  await Member.create({ name: 'Never Pays', phone: '0712000052', regNumber: 'W/002', openingBalance: 50000 });

  const sign = (user) => jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const [treasurer, superAdmin] = await User.create([
    { name: 'W Treasurer', email: 'w-treasurer@example.com', password: 'x', role: 'treasurer', active: true },
    { name: 'W Super', email: 'w-super@example.com', password: 'x', role: 'super_admin', active: true },
  ]);
  tokens = { treasurer: sign(treasurer), superAdmin: sign(superAdmin) };

  // Steady paid his 1,500 in every closed week (93-98).
  const weekly = await ContributionType.findOne({ name: WEEKLY_TYPE_NAME });
  for (let w = 93; w <= 98; w++) {
    await Contribution.create({
      memberId: steady._id,
      typeId: weekly._id,
      amount: 1500,
      grossAmount: 1500,
      date: new Date(weekRange(w, config).startDate.getTime() + 86400000),
      method: 'cash',
      loggedBy: treasurer._id,
    });
  }

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test('a preview says what the line will be and saves nothing', { skip }, async () => {
  const res = await raise(101, 2000, { dryRun: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const p = res.body.preview;
  assert.equal(p.fromWeek, 101);
  assert.equal(p.amountBefore, 1500);
  assert.equal(p.amountAfter, 2000);
  // 114,600 at week 92; weeks 93-101 each add what they ask.
  assert.equal(p.line.atStartBefore, 114600 + 9 * 1500);
  assert.equal(p.line.atStartAfter, 114600 + 8 * 1500 + 2000);
  assert.equal(p.line.nextWeekAfter, p.line.atStartAfter + 2000);
  assert.deepEqual(await changes(), [], 'a preview writes nothing');
});

test('nonsense and closed weeks are refused, with a message that says why', { skip }, async () => {
  const cases = [
    [{ amount: 2000 }, /which week/i],
    [{ fromWeek: 'soon', amount: 2000 }, /which week/i],
    [{ fromWeek: 101 }, /above zero/i],
    [{ fromWeek: 101, amount: 0 }, /above zero/i],
    [{ fromWeek: 101, amount: -5 }, /above zero/i],
    [{ fromWeek: 101, amount: 'lots' }, /above zero/i],
    [{ fromWeek: 101, amount: 50 }, /less than the tea/i],
    [{ fromWeek: 101, amount: 1500 }, /already/i],
    [{ fromWeek: current - 1, amount: 2000 }, /already started/i],
    [{ fromWeek: 93, amount: 2000 }, /already started/i],
  ];
  for (const [body, pattern] of cases) {
    const res = await api('POST', '/api/ledger/weekly-amount', { token: tokens.treasurer, body });
    assert.equal(res.status, 400, `${JSON.stringify(body)} should be refused: ${JSON.stringify(res.body)}`);
    assert.match(res.body.message, pattern, JSON.stringify(body));
  }
  assert.deepEqual(await changes(), [], 'every refusal writes nothing');
});

test('a rise from a future week is saved and audited, and the opening amount is untouched', { skip }, async () => {
  const res = await raise(101, 2000, { reason: 'Agreed at the 5 Nov meeting' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.schedule.changes.map((c) => [c.fromWeek, c.amount]), [[101, 2000]]);
  assert.equal(res.body.schedule.opening, 1500);
  assert.equal(res.body.schedule.now, 1500, 'week 99 still asks 1,500');

  const saved = await changes();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].reason, 'Agreed at the 5 Nov meeting');
  const audit = await AuditLog.findOne({ entityType: 'Settings', 'after.weeklyAmountChange.fromWeek': 101 }).lean();
  assert.ok(audit, 'the change is in the audit trail');
  assert.equal(audit.after.weeklyAmountChange.amount, 2000);

  const setup = (await api('GET', '/api/ledger/setup', { token: tokens.treasurer })).body.settings;
  assert.equal(setup.weeklyAmount, 1500, 'the form saves back the amount the cycle opened with');
  assert.equal(setup.weeklyAmountNow, 1500);
  assert.equal(setup.weeksClosed, 6);
  assert.deepEqual(setup.weeklyAmountChanges.map((c) => [c.fromWeek, c.amount]), [[101, 2000]]);
});

test('a rise changes nothing that has already happened', { skip }, async () => {
  const { ledger } = await ledgerOf(steady);
  assert.equal(ledger.required, 6 * 1500, 'the six closed weeks asked 1,500 each');
  assert.equal(ledger.arrears, 0, 'a member who paid every closed week in full still owes nothing');
  assert.equal(ledger.weeksBehind, 0);
  assert.equal(ledger.weeklyAmount, 1500);
  assert.equal(ledger.weeklyChanged, false);
  assert.equal(ledger.moneyLimit, 114600 + 7 * 1500, 'this week’s line is untouched by a rise that has not started');
  for (const w of ledger.weeks.filter((x) => !x.isBaseline && !x.isCurrent)) {
    assert.equal(w.weeklyAmount, 1500);
    assert.equal(w.status, 'paid');
  }
});

test('saving the same week again replaces the change; cancelling takes it back', { skip }, async () => {
  const replaced = await raise(101, 2200);
  assert.equal(replaced.status, 200, 'an existing week is replaced, not added');
  assert.deepEqual((await changes()).map((c) => [c.fromWeek, c.amount]), [[101, 2200]]);

  const cancelled = await api('DELETE', '/api/ledger/weekly-amount/101', { token: tokens.treasurer });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.deepEqual(await changes(), []);
  const audit = await AuditLog.findOne({ entityType: 'Settings', 'after.weeklyAmountChangeCancelled.fromWeek': 101 }).lean();
  assert.ok(audit, 'taking it back is audited too');

  assert.equal((await api('DELETE', '/api/ledger/weekly-amount/101', { token: tokens.treasurer })).status, 404);
});

test('a rise starting this week applies to this week only, and the closed weeks keep their amount', { skip }, async () => {
  const res = await raise(current, 1800);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { ledger } = await ledgerOf(steady);
  assert.equal(ledger.weeklyAmount, 1800, 'what is asked now');
  assert.equal(ledger.required, 6 * 1500, 'the closed weeks are not re-asked');
  assert.equal(ledger.arrears, 0);
  assert.equal(ledger.moneyLimit, 114600 + 6 * 1500 + 1800, 'this week adds the new amount to the line');
  const thisWeek = ledger.weeks.find((w) => w.isCurrent);
  assert.equal(thisWeek.weeklyAmount, 1800);
  await clear();
});

test('a change whose week has already closed cannot be taken back', { skip }, async () => {
  await Settings.updateOne({ key: 'main' }, { $set: { weeklyAmountChanges: [{ fromWeek: 95, amount: 1800 }] } });
  invalidateSettings();
  const res = await api('DELETE', '/api/ledger/weekly-amount/95', { token: tokens.treasurer });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.message, /already been asked/i);
  assert.equal((await changes()).length, 1, 'it stays');
  await clear();
});

test('the opening amount cannot be overwritten once weeks have been asked at it', { skip }, async () => {
  const refused = await api('PATCH', '/api/ledger/setup', { token: tokens.treasurer, body: { weeklyAmount: 2500 } });
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.match(refused.body.message, /already been asked/i);
  assert.equal((await Settings.findOne({ key: 'main' }).lean()).weeklyAmount, 1500);

  // Saving the screen with the same figure keeps working: it sends the amount back on every save.
  const same = await api('PATCH', '/api/ledger/setup', { token: tokens.treasurer, body: { weeklyAmount: '1,500', chaiAmount: 100 } });
  assert.equal(same.status, 200, JSON.stringify(same.body));
});

test('closed books hold a change that starts in the closed period; the super admin goes through with a reason', { skip }, async () => {
  // Books closed through the day week 100 starts, so a rise from week 100 is in the closed period and one from 101 is not.
  const lockDay = weekRange(100, config).startDate;
  await Settings.updateOne({ key: 'main' }, { $set: { lockedThrough: lockDay, lockReason: 'Agreed' } });
  invalidateSettings();

  const held = await raise(100, 2000);
  assert.equal(held.status, 423, JSON.stringify(held.body));
  assert.equal(held.body.code, 'period_locked');
  assert.deepEqual(await changes(), []);

  assert.equal((await raise(101, 2000)).status, 201, 'a change after the lock is fine');
  await api('DELETE', '/api/ledger/weekly-amount/101', { token: tokens.treasurer });

  const through = await api('POST', '/api/ledger/weekly-amount', {
    token: tokens.superAdmin,
    headers: { 'X-Override-Reason': encodeURIComponent('Group agreed to start the rise a week earlier') },
    body: { fromWeek: 100, amount: 2000 },
  });
  assert.equal(through.status, 201, JSON.stringify(through.body));
  await clear();
});

test('the weekly reconciliation reads each week against what that week asked', { skip }, async () => {
  assert.equal((await raise(current, 2000)).status, 201);
  const res = await api('GET', '/api/reports/weekly', { token: tokens.treasurer });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
  const weekly = (n) => res.body.weeks.find((w) => w.weekNumber === n).types.find((t) => t.typeName === WEEKLY_TYPE_NAME);
  assert.equal(weekly(98).weeklyAmount, 1500, 'a closed week keeps what it asked');
  assert.equal(weekly(98).expected, 2 * 1500, 'two members, 1,500 each');
  assert.equal(weekly(current).weeklyAmount, 2000, 'the week the rise started asks the new amount');
  assert.equal(weekly(current).expected, 2 * 2000);
  await clear();
});
