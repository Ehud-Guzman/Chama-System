// Issuing a fine respects closed books.
//
// A fine is money dated on a day. Settling, undoing and voiding one were already held by the period lock;
// issuing one was not, so a fine could still be back-dated into a period the committee had agreed. This holds
// it: refused for the office, and open to the super admin only with a written reason on the record.
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

const TEST_DB = 'chama-rehearsal-finelock';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(`TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run.`);
}

const app = require('../../src/app');
const Member = require('../../src/models/Member');
const User = require('../../src/models/User');
const Fine = require('../../src/models/Fine');
const FineType = require('../../src/models/FineType');
const Settings = require('../../src/models/Settings');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds } = require('../../src/utils/ledgerTypes');
const { seedDisciplinaryFineTypes } = require('../../src/utils/seedDisciplinaryFineTypes');
const { fridayOf } = require('../../src/utils/weekCycle');

let server;
let base;
let tokens;
let member;
let type;

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

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const issue = (token, date, headers) =>
  api('POST', '/api/fines', {
    token,
    headers,
    body: { memberId: String(member._id), typeId: String(type._id), amount: 50, reason: 'Late', date },
  });
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
  settings.weekAnchorDate = fridayOf(new Date(Date.now() - 21 * 86400000));
  await settings.save();
  invalidateSettings();
  await seedLedgerTypes();
  await seedGroupFunds();
  await seedDisciplinaryFineTypes();
  type = await FineType.findOne({ active: true });

  member = await Member.create({ name: 'Fine Lock One', phone: '0712000031', regNumber: 'F/001', openingBalance: 1000 });
  const sign = (user) => jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const [admin, superAdmin] = await User.create([
    { name: 'Fine Admin', email: 'fine-admin@example.com', password: 'x', role: 'admin', active: true },
    { name: 'Fine Super', email: 'fine-super@example.com', password: 'x', role: 'super_admin', active: true },
  ]);
  tokens = { admin: sign(admin), superAdmin: sign(superAdmin) };

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

test('with the books open, a fine can be issued with any date', { skip }, async () => {
  const res = await issue(tokens.admin, daysAgo(10));
  assert.equal(res.status, 201, JSON.stringify(res.body));
});

test('closed books refuse a fine back-dated into the closed period, and nothing is written', { skip }, async () => {
  await lock(true);
  try {
    const before = await Fine.countDocuments({});
    const refused = await issue(tokens.admin, daysAgo(10));
    assert.equal(refused.status, 423, JSON.stringify(refused.body));
    assert.equal(refused.body.code, 'period_locked');
    assert.equal(refused.body.canOverride, false);
    assert.equal(await Fine.countDocuments({}), before, 'a refused fine writes nothing');

    // The super admin is refused too, until a reason is given.
    const noReason = await issue(tokens.superAdmin, daysAgo(10));
    assert.equal(noReason.status, 423);
    assert.equal(noReason.body.canOverride, true);
  } finally {
    await lock(false);
  }
});

test('a fine dated after the lock goes through, and so does one with no date (today)', { skip }, async () => {
  await lock(true);
  try {
    assert.equal((await issue(tokens.admin, daysAgo(1))).status, 201);
    assert.equal((await issue(tokens.admin, undefined)).status, 201);
  } finally {
    await lock(false);
  }
});

test('the super admin can issue a back-dated fine with a written reason, which is recorded', { skip }, async () => {
  await lock(true);
  try {
    const res = await issue(tokens.superAdmin, daysAgo(10), {
      'X-Override-Reason': encodeURIComponent('Fine from the 22 Oct meeting, missed at the time'),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  } finally {
    await lock(false);
  }
});
