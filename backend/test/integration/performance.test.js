// Member performance at the very start of a cycle — the window where it reads 0/0 for everybody
// while the money is plainly coming in.
//
// This is pinned as a test because it looks like a fault and is not one, and because the "obvious
// fix" is the one thing that must not happen: counting the week still running as an expected week
// would mark every member late for money nobody has been asked for yet, and it would disagree with
// the passbook, the reminders and the ledger, all of which refuse to score a week before its
// Thursday has passed.
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
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-performance';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(
    `TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run. ` +
      'Name it with "rehearsal", "scratch" or "test" in it.'
  );
}

const app = require('../../src/app');
const Member = require('../../src/models/Member');
const User = require('../../src/models/User');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds } = require('../../src/utils/ledgerTypes');
const { fridayOf, toEatDateString } = require('../../src/utils/weekCycle');

let server;
let base;
let token;
let paidMember;
let unpaidMember;

const api = (method, route, body) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

test.before(async () => {
  if (skip) return;

  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  // The cycle opened on the most recent Friday — so the opening week is the week running today,
  // and NOTHING has closed yet. This is the state the live books were in on the day this report
  // was reported as looking broken.
  const settings = await getOrCreateSettings();
  settings.cycleStartWeek = 92;
  settings.weeklyAmount = 1400;
  settings.chaiAmount = 100;
  settings.weekAnchorDate = fridayOf(new Date());
  await settings.save();
  invalidateSettings();

  await seedLedgerTypes();
  await seedGroupFunds();

  await User.create({
    name: 'Rehearsal Admin',
    email: 'performance@example.com',
    password: await bcrypt.hash('rehearsal-password', 10),
    role: 'super_admin',
    active: true,
  });

  [paidMember, unpaidMember] = await Member.create([
    { name: 'Paid Today', phone: '0714000001', regNumber: 'P/001', openingBalance: 0 },
    { name: 'Not Yet', phone: '0714000002', regNumber: 'P/002', openingBalance: 0 },
  ]);

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const login = await api('POST', '/api/auth/login', {
    email: 'performance@example.com',
    password: 'rehearsal-password',
  });
  const body = await login.json();
  assert.equal(login.status, 200, 'the rehearsal admin could not sign in');
  token = body.token;

  // One member pays the week's 1,400, dated today: inside the running week.
  const logged = await api('POST', `/api/ledger/members/${paidMember._id}/log`, {
    kind: 'weekly',
    amount: 1400,
    method: 'cash',
    date: toEatDateString(new Date()),
    note: '',
    description: '',
    clientRequestId: `performance-${Date.now()}`,
  });
  assert.equal(logged.status, 201, 'the ledger did not accept the payment');
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test('a payment in the running week shows as this week, not as a closed week', { skip }, async () => {
  const res = await api('GET', '/api/reports/performance');
  assert.equal(res.status, 200);
  const { members } = await res.json();

  const paid = members.find((m) => String(m.memberId) === String(paidMember._id));
  const unpaid = members.find((m) => String(m.memberId) === String(unpaidMember._id));
  assert.ok(paid && unpaid, 'both members should be in the report');

  // Nothing has closed: the opening week is the baseline and the week running now is not scored.
  // So the ratio is 0/0 for EVERYBODY and consistency is null, which the screen draws as "—".
  // This is the state that looks broken and is correct.
  for (const row of [paid, unpaid]) {
    assert.equal(row.weeksExpected, 0, `${row.name}: no week has closed yet`);
    assert.equal(row.weeksPaid, 0);
    assert.equal(row.consistency, null);
  }

  // And the figures that DO say something: the week running, and what has come in for it.
  assert.equal(paid.paidThisWeek, 1400, 'the payment belongs to the running week');
  assert.equal(paid.runningWeek, 92, 'the opening week is the week running today');
  assert.equal(unpaid.paidThisWeek, 0);
  assert.equal(paid.weeklyAmount, 1400);
});

test('the report and the passbook agree about that week', { skip }, async () => {
  // The rule is only defensible if every screen tells the same story, so this checks the engine
  // the member's own page reads: his money moved by the 1,400, and nothing was scored.
  const res = await api('GET', `/api/ledger/members/${paidMember._id}`);
  assert.equal(res.status, 200);
  const { ledger } = await res.json();

  assert.equal(ledger.weeksScored, 0, 'no week has been scored');
  assert.equal(ledger.required, 0, 'nothing is required of anybody yet');
  assert.equal(ledger.arrears, 0, 'so nobody can be behind');
  // He holds what he paid, and the week he paid it against is the one running.
  assert.equal(ledger.money, 1400);
  const running = ledger.weeks.find((w) => w.isCurrent);
  assert.equal(running.personalPaid, 1400);
});
