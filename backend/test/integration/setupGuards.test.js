// The finance setup screen's guards, end to end.
//
// The setup save is the one request that can rewrite every member's money at once, so two things
// are held here that a pure-function test cannot reach:
//
//   1. a figure no balance could be (below nothing, past a billion) is refused whole — and a request
//      refused part-way never leaves the cycle figures it had already read live in the cached
//      settings document, which every other request would then have used;
//   2. once the books are closed, a save that really changes a figure is held by the lock like any
//      other money write, while saving the screen with nothing altered keeps working.
//
// Needs a scratch MongoDB — see the note at the top of ledger.test.js. It creates and drops its own
// database and refuses a URI that does not look like a scratch one.
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

const TEST_DB = 'chama-rehearsal-setupguards';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(`TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run.`);
}

const app = require('../../src/app');
const Member = require('../../src/models/Member');
const User = require('../../src/models/User');
const Settings = require('../../src/models/Settings');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds } = require('../../src/utils/ledgerTypes');
const { fridayOf } = require('../../src/utils/weekCycle');

let server;
let base;
let tokens;
let memberA;
let memberB;

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

const balances = (a, b) => [
  { memberId: String(memberA._id), openingBalance: a },
  { memberId: String(memberB._id), openingBalance: b },
];
const balanceOf = async (member) => (await Member.findById(member._id).lean()).openingBalance;
const lock = async (on) => {
  await Settings.updateOne(
    { key: 'main' },
    { $set: { lockedThrough: on ? new Date(Date.now() - 5 * 86400000) : null, lockReason: on ? 'Agreed' : '' } }
  );
  invalidateSettings();
};

test.before(async () => {
  if (skip) return;
  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  const settings = await getOrCreateSettings();
  settings.cycleStartWeek = 92;
  settings.weeklyAmount = 1500;
  settings.chaiAmount = 100;
  settings.weekAnchorDate = fridayOf(new Date(Date.now() - 21 * 86400000));
  await settings.save();
  invalidateSettings();
  await seedLedgerTypes();
  await seedGroupFunds();

  [memberA, memberB] = await Member.create([
    { name: 'Guard One', phone: '0712000011', regNumber: 'G/001', openingBalance: 10000 },
    { name: 'Guard Two', phone: '0712000012', regNumber: 'G/002', openingBalance: 5000 },
  ]);
  const sign = (user) => jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const [treasurer, superAdmin] = await User.create([
    { name: 'Guard Treasurer', email: 'treasurer@example.com', password: 'x', role: 'treasurer', active: true },
    { name: 'Guard Super', email: 'super@example.com', password: 'x', role: 'super_admin', active: true },
  ]);
  tokens = { treasurer: sign(treasurer), superAdmin: sign(superAdmin) };

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

test('a balance below nothing or past a billion is refused, and nothing is written', { skip }, async () => {
  for (const bad of ['-5000', 99999999999]) {
    const res = await api('PATCH', '/api/ledger/setup', { token: tokens.treasurer, body: { balances: balances(bad, 5000) } });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /out of range/);
  }
  assert.equal(await balanceOf(memberA), 10000);
  assert.equal(await balanceOf(memberB), 5000);
});

test('a request refused part-way leaves the cycle figures exactly as they were', { skip }, async () => {
  const stored = async () => Settings.findOne({ key: 'main' }).lean();

  // A new weekly amount together with tea larger than it. Weeks have already been asked 1,500, so the weekly
  // amount is refused outright (a rise goes through POST /api/ledger/weekly-amount); either way nothing stays live.
  const both = await api('PATCH', '/api/ledger/setup', {
    token: tokens.treasurer,
    body: { weeklyAmount: 2000, chaiAmount: 5000 },
  });
  assert.equal(both.status, 400, JSON.stringify(both.body));
  assert.match(both.body.message, /already been asked/i);

  // The weekly amount left alone and only the tea too large: the tea is the reason, and nothing stays live.
  const tea = await api('PATCH', '/api/ledger/setup', {
    token: tokens.treasurer,
    body: { weeklyAmount: 1500, chaiAmount: 5000 },
  });
  assert.equal(tea.status, 400, JSON.stringify(tea.body));
  assert.match(tea.body.message, /tea/i);

  const read = await api('GET', '/api/ledger/setup', { token: tokens.treasurer });
  assert.equal(read.body.settings.weeklyAmount, 1500, 'what the next request reads');
  assert.equal(read.body.settings.chaiAmount, 100);
  assert.equal((await stored()).weeklyAmount, 1500, 'and what is stored');
  assert.equal((await stored()).chaiAmount, 100);
});


test('closed books hold a real change to the setup, but not a save with nothing altered', { skip }, async () => {
  await lock(true);
  try {
    // The screen sends every box back as it is: that must keep working.
    const same = await api('PATCH', '/api/ledger/setup', {
      token: tokens.treasurer,
      body: { weeklyAmount: '1,500', chaiAmount: 100, balances: balances('10,000', 5000) },
    });
    assert.equal(same.status, 200, JSON.stringify(same.body));

    const changed = await api('PATCH', '/api/ledger/setup', { token: tokens.treasurer, body: { balances: balances(12000, 5000) } });
    assert.equal(changed.status, 423, JSON.stringify(changed.body));
    assert.equal(changed.body.code, 'period_locked');
    assert.equal(changed.body.canOverride, false);
    assert.equal(await balanceOf(memberA), 10000, 'a held save writes nothing');

    const cycle = await api('PATCH', '/api/ledger/setup', { token: tokens.treasurer, body: { weeklyAmount: 1600 } });
    assert.equal(cycle.status, 423, 'the cycle figures are held too');

    // The super admin needs a reason, and then goes through with it on the record.
    const noReason = await api('PATCH', '/api/ledger/setup', { token: tokens.superAdmin, body: { balances: balances(12000, 5000) } });
    assert.equal(noReason.status, 423);
    assert.equal(noReason.body.canOverride, true);
    const through = await api('PATCH', '/api/ledger/setup', {
      token: tokens.superAdmin,
      headers: { 'X-Override-Reason': encodeURIComponent('Paper register corrected at the meeting') },
      body: { balances: balances(12000, 5000) },
    });
    assert.equal(through.status, 200, JSON.stringify(through.body));
    assert.equal(await balanceOf(memberA), 12000);
  } finally {
    await lock(false);
  }
});

test('with the books open the same change goes straight through', { skip }, async () => {
  const res = await api('PATCH', '/api/ledger/setup', { token: tokens.treasurer, body: { balances: balances(13000, 5000) } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await balanceOf(memberA), 13000);
});
