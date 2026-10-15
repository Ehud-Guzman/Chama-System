// The members' passbook and its second check.
//
// A member opens his own passbook with his ID. An ID is on a card and in other people's phones, so
// the group can switch on a second check: the phone number registered on his record. These pin
// that it is off until somebody turns it on (a deploy must not lock anybody out), that once on it
// is asked for on the passbook and on both statement downloads, that a number written any of the
// usual ways works, and that the group's papers stay on the ID alone.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';
// This suite looks a member up a dozen times in a minute; the limiter's own behaviour is not what it tests.
process.env.LOOKUP_RATE_LIMIT_MAX = '1000';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB - run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-passbookphone';
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
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds } = require('../../src/utils/ledgerTypes');
const { fridayOf } = require('../../src/utils/weekCycle');

let server;
let base;
let superToken;
let adminToken;

const api = (method, route, body, auth) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

async function call(method, route, body, auth) {
  const res = await api(method, route, body, auth);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const login = async (email) => {
  const res = await call('POST', '/api/auth/login', { email, password: 'rehearsal-password' });
  assert.equal(res.status, 200, `${email} could not sign in`);
  return res.body.token;
};

test.before(async () => {
  if (skip) return;
  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  const settings = await getOrCreateSettings();
  settings.weekAnchorDate = fridayOf(new Date());
  await settings.save();
  invalidateSettings();
  await seedLedgerTypes();
  await seedGroupFunds();

  const password = await bcrypt.hash('rehearsal-password', 10);
  await User.create([
    { name: 'Super', email: 'super@example.com', password, role: 'super_admin', active: true },
    { name: 'Admin', email: 'admin@example.com', password, role: 'admin', active: true },
  ]);
  await Member.create({
    name: 'Grace Achieng',
    phone: '0712345678',
    regNumber: 'PB/001',
    nationalId: '23456789',
    openingBalance: 5000,
  });

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  superToken = await login('super@example.com');
  adminToken = await login('admin@example.com');
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

const lookup = (query) => call('GET', `/api/public/lookup?${new URLSearchParams(query)}`);

test('the second check is off by default: the ID alone opens the passbook, as it always has', { skip }, async () => {
  const res = await lookup({ nationalId: '23456789' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.name, 'Grace Achieng');
});

test('only the super admin can switch it on', { skip }, async () => {
  const refused = await call('PATCH', '/api/settings', { passbookPhoneCheck: true }, adminToken);
  assert.equal(refused.status, 403);
  const junk = await call('PATCH', '/api/settings', { passbookPhoneCheck: 'yes' }, superToken);
  assert.equal(junk.status, 400);

  const done = await call('PATCH', '/api/settings', { passbookPhoneCheck: true }, superToken);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.settings.passbookPhoneCheck, true);
});

test('with it on, the ID alone is asked for the phone number, and nothing is shown', { skip }, async () => {
  const res = await lookup({ nationalId: '23456789' });
  assert.equal(res.status, 401);
  assert.equal(res.body.phoneRequired, true);
  assert.equal(res.body.name, undefined, 'none of his record is given before the number is right');
});

test('a wrong number is refused in words, and the right one, written any way, opens it', { skip }, async () => {
  const wrong = await lookup({ nationalId: '23456789', phone: '0799999999' });
  assert.equal(wrong.status, 403);
  assert.match(wrong.body.message, /does not match/);
  assert.equal(wrong.body.name, undefined);

  for (const phone of ['0712345678', '0712 345 678', '+254712345678', '254712345678', '712345678']) {
    const ok = await lookup({ nationalId: '23456789', phone });
    assert.equal(ok.status, 200, `${phone}: ${JSON.stringify(ok.body)}`);
    assert.equal(ok.body.name, 'Grace Achieng');
  }
  // Too short to compare is the same as none.
  assert.equal((await lookup({ nationalId: '23456789', phone: '2345' })).status, 401);
});

test('the statement downloads ask for it too', { skip }, async () => {
  for (const route of ['/api/public/lookup/statement', '/api/public/lookup/statement/excel']) {
    const without = await call('GET', `${route}?nationalId=23456789`);
    assert.equal(without.status, 401, route);
    const wrong = await call('GET', `${route}?nationalId=23456789&phone=0700000000`);
    assert.equal(wrong.status, 403, route);
    const right = await api('GET', `${route}?nationalId=23456789&phone=0712345678`);
    assert.equal(right.status, 200, route);
    await right.arrayBuffer();
  }
});

test('an ID nobody holds is still just not found, whatever number comes with it', { skip }, async () => {
  const res = await lookup({ nationalId: '99999999', phone: '0712345678' });
  assert.equal(res.status, 404);
});

test('the group papers stay on the ID alone', { skip }, async () => {
  const res = await call('GET', '/api/public/minutes?nationalId=23456789');
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('switching it off puts things back', { skip }, async () => {
  const done = await call('PATCH', '/api/settings', { passbookPhoneCheck: false }, superToken);
  assert.equal(done.status, 200);
  assert.equal((await lookup({ nationalId: '23456789' })).status, 200);
});
