// A member who leaves: his accounting stops the day he does.
//
// A member made inactive used to go on being charged tea and having missed weeks counted for as
// long as the system ran, while the group's own tea income dropped his past weeks the moment he
// went. These pin the other way round, against a real MongoDB: the day he left is recorded, his
// figures are read as at that day, the group keeps the tea he paid while he was a member, and money
// paid out to him on the way out leaves the group's balance on that day.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB - run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-leaving';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(
    `TEST_MONGO_URI (${URI}) does not look like a scratch database - refusing to run. ` +
      'Name it with "rehearsal", "scratch" or "test" in it.'
  );
}

const app = require('../../src/app');
const User = require('../../src/models/User');
const Member = require('../../src/models/Member');
const Expense = require('../../src/models/Expense');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds } = require('../../src/utils/ledgerTypes');
const { fridayOf, resolveConfig, scoredWeeks } = require('../../src/utils/weekCycle');
const { computeMoneyPosition } = require('../../src/utils/moneyPosition');
const { backfillDeactivatedAt } = require('../../src/utils/backfillDeactivatedAt');

let server;
let base;
let token;
let config;
const DAY = 24 * 60 * 60 * 1000;

const api = (method, route, body) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

async function call(method, route, body) {
  const res = await api(method, route, body);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let counter = 0;
const make = (over = {}) => {
  counter += 1;
  return Member.create({
    name: `Leaver ${counter}`,
    phone: `07200000${String(counter).padStart(2, '0')}`,
    regNumber: `LV/${String(counter).padStart(3, '0')}`,
    openingBalance: 0,
    ...over,
  });
};

test.before(async () => {
  if (skip) return;
  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  // A cycle that opened ten weeks ago, so there are closed weeks to charge and to stop charging.
  const settings = await getOrCreateSettings();
  settings.cycleStartWeek = 92;
  settings.weeklyAmount = 1400;
  settings.chaiAmount = 100;
  settings.weekAnchorDate = fridayOf(new Date(Date.now() - 70 * DAY));
  await settings.save();
  invalidateSettings();
  config = resolveConfig(settings);
  await seedLedgerTypes();
  await seedGroupFunds();

  await User.create({
    name: 'Rehearsal Admin',
    email: 'leaving@example.com',
    password: await bcrypt.hash('rehearsal-password', 10),
    role: 'super_admin',
    active: true,
  });

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await call('POST', '/api/auth/login', { email: 'leaving@example.com', password: 'rehearsal-password' });
  assert.equal(login.status, 200);
  token = login.body.token;
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test('the day he was made inactive is recorded, and clearing it is what reactivating does', { skip }, async () => {
  const m = await make();
  assert.equal((await Member.findById(m._id).lean()).deactivatedAt, null);

  const before = Date.now();
  const gone = await call('DELETE', `/api/members/${m._id}`);
  assert.equal(gone.status, 200);
  const stored = await Member.findById(m._id).lean();
  assert.equal(stored.active, false);
  assert.ok(new Date(stored.deactivatedAt).getTime() >= before - 1000);

  // Saving a form that still says inactive does not move the day.
  const first = new Date(stored.deactivatedAt).getTime();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await call('PATCH', `/api/members/${m._id}`, { notes: 'edited later', active: false });
  assert.equal(new Date((await Member.findById(m._id).lean()).deactivatedAt).getTime(), first);

  const back = await call('PATCH', `/api/members/${m._id}`, { active: true });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal((await Member.findById(m._id).lean()).deactivatedAt, null);

  // And switching it off through the edit form records the day too.
  await call('PATCH', `/api/members/${m._id}`, { active: false });
  assert.ok((await Member.findById(m._id).lean()).deactivatedAt);
});

test('his record is frozen at the day he left: no more tea, no more missed weeks', { skip }, async () => {
  const leftAt = new Date(Date.now() - 35 * DAY);
  const m = await make({ openingBalance: 5000, active: false, deactivatedAt: leftAt });
  const stayed = await make({ openingBalance: 5000 });

  const weeksWhileMember = scoredWeeks(config, leftAt.getTime());
  const weeksSoFar = scoredWeeks(config);
  assert.ok(weeksSoFar > weeksWhileMember && weeksWhileMember > 0, 'the fixture has weeks on both sides of the day he left');

  const gone = await call('GET', `/api/ledger/members/${m._id}`);
  assert.equal(gone.status, 200);
  assert.equal(gone.body.ledger.weeksScored, weeksWhileMember);
  assert.equal(gone.body.ledger.chai.due, 100 * weeksWhileMember);
  assert.equal(gone.body.ledger.money, 5000 - 100 * weeksWhileMember);
  assert.equal(new Date(gone.body.ledger.endedAt).getTime(), leftAt.getTime());
  assert.equal(gone.body.ledger.arrears, 1400 * weeksWhileMember, 'only the weeks he was a member still count as missed');

  const still = await call('GET', `/api/ledger/members/${stayed._id}`);
  assert.equal(still.body.ledger.weeksScored, weeksSoFar);
  assert.equal(still.body.ledger.endedAt, null);
  assert.equal(still.body.ledger.money, 5000 - 100 * weeksSoFar);

  // The record page agrees, and its working still closes on the figure.
  const record = await call('GET', `/api/members/${m._id}`);
  assert.equal(record.body.ledger.money, 5000 - 100 * weeksWhileMember);
  assert.equal(record.body.walk.balanced, true);
});

test('the Tea Fund keeps what a leaver paid while he was a member, and stops there', { skip }, async () => {
  const leftAt = new Date(Date.now() - 21 * DAY);
  const active = await Member.countDocuments({ active: true });
  const leavers = await Member.find({ active: false }).select('active deactivatedAt resignedAt updatedAt').lean();
  const { membershipEnd } = require('../../src/utils/membership');
  const m = await make({ active: false, deactivatedAt: leftAt });
  const everyone = [...leavers, m.toObject()];

  const expectedWeeks =
    scoredWeeks(config) * active + everyone.reduce((sum, x) => sum + scoredWeeks(config, membershipEnd(x).getTime()), 0);

  const position = await computeMoneyPosition();
  const tea = position.funds.find((f) => /chai|tea/i.test(f.name));
  assert.ok(tea, 'the Tea Fund is listed');
  assert.equal(tea.derived, 100 * expectedWeeks);

  // Strictly more than counting only today's members would have said, which is the flaw this fixes.
  assert.ok(tea.derived > 100 * scoredWeeks(config) * active);
});

test('resigning with a payout takes the money out of the group on the day he leaves', { skip }, async () => {
  const m = await make({ openingBalance: 3000 });

  const bad = await call('POST', `/api/members/${m._id}/resign`, { reason: 'Moved', payout: -5 });
  assert.equal(bad.status, 400);
  assert.equal((await Member.findById(m._id).lean()).active, true, 'nothing happened');

  const done = await call('POST', `/api/members/${m._id}/resign`, { reason: 'Moved away', payout: 2800 });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.paidOut, 2800);

  const stored = await Member.findById(m._id).lean();
  assert.equal(stored.active, false);
  assert.equal(new Date(stored.deactivatedAt).getTime(), new Date(stored.resignedAt).getTime());
  assert.equal(stored.resignationSettlement, 'Paid out Ksh 2,800', 'a payout is itself the account of his money');

  const expense = await Expense.findOne({ description: new RegExp(m.name) }).lean();
  assert.ok(expense, 'the payout is on the books');
  assert.equal(expense.source, 'group');
  assert.equal(expense.amount, 2800);
  assert.equal(new Date(expense.date).getTime(), new Date(stored.resignedAt).getTime());
  assert.equal(expense.note, 'Paid out Ksh 2,800');

  const position = await computeMoneyPosition();
  assert.ok(position.totalExpenses >= 2800, 'the group balance is down by what was paid out');
});

test('a payout of nothing, or none at all, records no spending', { skip }, async () => {
  const before = await Expense.countDocuments({});
  const m = await make({ openingBalance: 0 });
  const done = await call('POST', `/api/members/${m._id}/resign`, { reason: 'Left', payout: '' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.paidOut, 0);
  assert.equal(await Expense.countDocuments({}), before);
});

test('members made inactive before the day was recorded get it from the audit trail', { skip }, async () => {
  const m = await make();
  assert.equal((await call('DELETE', `/api/members/${m._id}`)).status, 200);
  const real = new Date((await Member.findById(m._id).lean()).deactivatedAt).getTime();

  // The state of a member deactivated before this existed: inactive, no day recorded.
  await Member.updateOne({ _id: m._id }, { $unset: { deactivatedAt: 1 } }, { timestamps: false });
  // And one with no audit entry at all, only a resignation date.
  const resigned = new Date(Date.now() - 40 * DAY);
  const n = await make({ active: false, resignedAt: resigned });

  const dry = await backfillDeactivatedAt({ dryRun: true });
  assert.ok(dry.filled.some((r) => String(r.id) === String(m._id)));
  assert.equal((await Member.findById(m._id).lean()).deactivatedAt ?? null, null, 'a dry run writes nothing');

  const result = await backfillDeactivatedAt();
  const fromAudit = result.filled.find((r) => String(r.id) === String(m._id));
  assert.equal(fromAudit.from, 'audit trail');
  // The audit entry is written a moment after the record was saved, so the two are close, not identical.
  const filledAt = new Date((await Member.findById(m._id).lean()).deactivatedAt).getTime();
  assert.ok(Math.abs(filledAt - real) < 2000, `${filledAt} is not within two seconds of ${real}`);

  const fromResignation = result.filled.find((r) => String(r.id) === String(n._id));
  assert.equal(fromResignation.from, 'resignation date');
  assert.equal(new Date((await Member.findById(n._id).lean()).deactivatedAt).getTime(), resigned.getTime());

  // Run again: nothing is left to fill, and nothing is changed.
  const again = await backfillDeactivatedAt();
  assert.equal(again.filled.length, 0);
  assert.equal(new Date((await Member.findById(m._id).lean()).deactivatedAt).getTime(), filledAt);
});
