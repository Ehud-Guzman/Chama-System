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
// This suite gets a member's phone number wrong on purpose, several times; the gate's own limits are
// not what it tests (memberGate.test.js does).
process.env.GATE_ATTEMPT_MAX = '1000';
process.env.GATE_SPRAY_MAX = '1000';
process.env.GATE_TARGET_MAX = '1000';

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
    email: 'grace@example.com',
    nextOfKin: [{ name: 'Peter Achieng', relationship: 'Brother', phone: '0722000000' }],
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

// The lookup is a POST: the ID and the phone number are credentials, and a URL is copied into history
// and into every log between the phone and the server.
const lookup = (body) => call('POST', '/api/public/lookup', body);
const passFrom = (res) => ({ 'X-Member-Token': res.body.memberToken });
const callWith = async (method, route, headers) => {
  const res = await fetch(`${base}${route}`, { method, headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('the second check is off by default: the ID alone opens the passbook, as it always has', { skip }, async () => {
  const res = await lookup({ nationalId: '23456789' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.name, 'Grace Achieng');
  assert.equal(typeof res.body.memberToken, 'string', 'the lookup hands back the pass the rest of the area uses');
});

test('an ID alone does not hand over his email or his next of kin', { skip }, async () => {
  // They are more sensitive than the balance, and an ID is on a card. They come only with the phone.
  const res = await lookup({ nationalId: '23456789' });
  assert.equal(res.body.email, undefined);
  assert.equal(res.body.nextOfKin, undefined);
  assert.equal(res.body.contactsHeld, true);
});

test('the overview tells the form whether to ask for the phone', { skip }, async () => {
  const off = await call('GET', '/api/public/overview');
  assert.equal(off.body.passbookPhoneCheck, false);
});

test('only the super admin can switch it on', { skip }, async () => {
  const refused = await call('PATCH', '/api/settings', { passbookPhoneCheck: true }, adminToken);
  assert.equal(refused.status, 403);
  const junk = await call('PATCH', '/api/settings', { passbookPhoneCheck: 'yes' }, superToken);
  assert.equal(junk.status, 400);

  const done = await call('PATCH', '/api/settings', { passbookPhoneCheck: true }, superToken);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.settings.passbookPhoneCheck, true);

  const on = await call('GET', '/api/public/overview');
  assert.equal(on.body.passbookPhoneCheck, true);
});

test('with it on, the ID alone opens nothing', { skip }, async () => {
  const res = await lookup({ nationalId: '23456789' });
  assert.equal(res.status, 401);
  assert.equal(res.body.phoneRequired, true);
  assert.equal(res.body.name, undefined, 'none of his record is given before the number is right');
  assert.equal(res.body.memberToken, undefined);
});

test('a wrong number, an ID nobody holds and a missing number all get the same answer', { skip }, async () => {
  // Any difference between these is a way to ask the gate "is this number a member?" without owning
  // the number, so there is none: same status, same words, same body.
  const wrongPhone = await lookup({ nationalId: '23456789', phone: '0799999999' });
  const noSuchId = await lookup({ nationalId: '99999999', phone: '0712345678' });
  const noPhone = await lookup({ nationalId: '23456789' });
  assert.equal(wrongPhone.status, 401);
  assert.deepEqual(noSuchId.body, wrongPhone.body);
  assert.equal(noSuchId.status, wrongPhone.status);
  assert.deepEqual(noPhone.body, wrongPhone.body);
  assert.equal(noPhone.status, wrongPhone.status);
  assert.equal(wrongPhone.body.name, undefined);
});

test('the right number, written any way, opens it - and brings his contacts with it', { skip }, async () => {
  for (const phone of ['0712345678', '0712 345 678', '+254712345678', '254712345678', '712345678']) {
    const ok = await lookup({ nationalId: '23456789', phone });
    assert.equal(ok.status, 200, `${phone}: ${JSON.stringify(ok.body)}`);
    assert.equal(ok.body.name, 'Grace Achieng');
    assert.equal(ok.body.email, 'grace@example.com');
    assert.equal(ok.body.nextOfKin[0].name, 'Peter Achieng');
    assert.equal(ok.body.contactsHeld, undefined);
  }
  // Too short to compare is the same as none.
  assert.equal((await lookup({ nationalId: '23456789', phone: '2345' })).status, 401);
});

test('the number in the URL no longer opens anything', { skip }, async () => {
  const get = await call('GET', '/api/public/lookup?nationalId=23456789&phone=0712345678');
  assert.equal(get.status, 404, 'there is no GET lookup any more: a credential does not belong in a URL');
});

test('the statement downloads need the pass the phone earned, not the ID', { skip }, async () => {
  const full = await lookup({ nationalId: '23456789', phone: '0712345678' });
  // The records gate asks for the ID alone, so its pass says the phone was not checked.
  const idOnly = await call('POST', '/api/public/records/unlock', { nationalId: '23456789' });
  assert.equal(idOnly.status, 200);

  for (const route of ['/api/public/lookup/statement', '/api/public/lookup/statement/excel']) {
    const none = await callWith('GET', route, {});
    assert.equal(none.status, 401, route);

    const weak = await callWith('GET', route, passFrom(idOnly));
    assert.equal(weak.status, 401, `${route}: a pass earned with the ID alone must not open his money`);
    assert.equal(weak.body.sessionEnded, true);

    const urlOnly = await callWith('GET', `${route}?nationalId=23456789&phone=0712345678`, {});
    assert.equal(urlOnly.status, 401, `${route}: credentials in the URL open nothing`);

    const strong = await fetch(`${base}${route}`, { headers: passFrom(full) });
    assert.equal(strong.status, 200, route);
    await strong.arrayBuffer();
  }
});

test('the group papers stay on the ID alone', { skip }, async () => {
  const unlocked = await call('POST', '/api/public/records/unlock', { nationalId: '23456789' });
  assert.equal(unlocked.status, 200, JSON.stringify(unlocked.body));
  const res = await callWith('GET', '/api/public/minutes', passFrom(unlocked));
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('switching it off puts things back', { skip }, async () => {
  const done = await call('PATCH', '/api/settings', { passbookPhoneCheck: false }, superToken);
  assert.equal(done.status, 200);
  assert.equal((await lookup({ nationalId: '23456789' })).status, 200);
  // ...and an ID nobody holds is, with nothing more to protect, plainly not found again.
  assert.equal((await lookup({ nationalId: '99999999' })).status, 404);
});
