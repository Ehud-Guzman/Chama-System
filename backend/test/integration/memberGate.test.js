// The members' gate, end to end: the four limits in front of it, the pass behind it, and what each
// role can and cannot read of the register.
//
// These are the behaviours a code review found missing and no pure test can prove, because they are
// about the limiter's keys and its store, the order middleware runs in, and what really leaves the
// server:
//
//   * a member who opens his passbook and downloads two statements has spent none of his budget;
//   * a script working through ID numbers from one address runs out, and an IPv6 client is one client
//     however many addresses its /64 holds;
//   * a phone number cannot be ground down by trying from many addresses at once;
//   * a pass is not an office session, and an office session is not a pass;
//   * the passbook is never stored by a browser; and the disciplinary officer cannot read the keys to
//     everybody's passbook out of the register.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';
// Small, so the suite can reach each limit in a handful of requests.
process.env.GATE_ATTEMPT_MAX = '3';
process.env.GATE_SPRAY_MAX = '6';
process.env.GATE_TARGET_MAX = '4';
process.env.SECURITY_ALERTS = 'off';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB - run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-membergate';
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
const SecurityEvent = require('../../src/models/SecurityEvent');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds } = require('../../src/utils/ledgerTypes');
const { fridayOf } = require('../../src/utils/weekCycle');

let server;
let base;
let superToken;
let adminToken;
let disciplinaryToken;

// `from` is the address the request appears to come from. The app trusts one proxy hop, so the
// forwarded header is what the limiters see as the client.
async function call(method, route, body, { auth, from, headers } = {}) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(from ? { 'X-Forwarded-For': from } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => ({})) };
}

const lookup = (nationalId, from, phone) =>
  call('POST', '/api/public/lookup', { nationalId, ...(phone ? { phone } : {}) }, { from });

const login = async (email) => {
  const res = await call('POST', '/api/auth/login', { email, password: 'rehearsal-password' });
  assert.equal(res.status, 200, `${email} could not sign in`);
  return res.body.token;
};

const MEMBERS = [
  { name: 'Alice Wanjiru', phone: '0711000001', nationalId: '31000001', regNumber: 'G/001' },
  { name: 'Brian Otieno', phone: '0711000002', nationalId: '31000002', regNumber: 'G/002' },
  { name: 'Carol Njeri', phone: '0711000003', nationalId: '31000003', regNumber: 'G/003' },
  { name: 'David Kiprop', phone: '0711000004', nationalId: '31000004', regNumber: 'G/004' },
  { name: 'Esther Mwende', phone: '0711000005', nationalId: '12345678', regNumber: 'G/005' },
];

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
    { name: 'Discipline', email: 'disc@example.com', password, role: 'disciplinary', active: true },
  ]);
  await Member.create(MEMBERS);

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  superToken = await login('super@example.com');
  adminToken = await login('admin@example.com');
  disciplinaryToken = await login('disc@example.com');
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------------
// The limits
// ---------------------------------------------------------------------------------

test('a member who opens his passbook and downloads two statements spends none of his budget', { skip }, async () => {
  const from = '198.51.100.10';
  // Far more successful requests than any of the failure limits allow.
  for (let i = 0; i < 4; i += 1) {
    for (const id of ['31000001', '31000002', '31000003']) {
      const opened = await lookup(id, from);
      assert.equal(opened.status, 200, `${id} try ${i + 1}: ${JSON.stringify(opened.body)}`);
      for (const route of ['/api/public/lookup/statement', '/api/public/lookup/statement/excel']) {
        const res = await fetch(`${base}${route}`, {
          headers: { 'X-Member-Token': opened.body.memberToken, 'X-Forwarded-For': from },
        });
        assert.equal(res.status, 200, route);
        await res.arrayBuffer();
      }
    }
  }
});

test('trying the same wrong number over and over from one address is stopped, and only for that number', { skip }, async () => {
  const from = '198.51.100.20';
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await lookup('31999999', from)).status, 404, `try ${i + 1}`);
  }
  assert.equal((await lookup('31999999', from)).status, 429);
  // A different number from the same connection is a different question.
  assert.equal((await lookup('31000001', from)).status, 200);
});

test('one address working through many numbers runs out', { skip }, async () => {
  const from = '198.51.100.30';
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await lookup(`3199000${i}`, from)).status, 404, `number ${i + 1}`);
  }
  const blocked = await lookup('31999990', from);
  assert.equal(blocked.status, 429);
  // ...and a real member's number from that address is turned away too: the address is the problem.
  assert.equal((await lookup('31000001', from)).status, 429);
});

test('an IPv6 client is one client, however many addresses its /64 holds', { skip }, async () => {
  for (let i = 0; i < 6; i += 1) {
    // Six different addresses in the same /64, each making one failed try.
    const from = `2001:db8:aaaa:bbbb::${i + 1}`;
    assert.equal((await lookup(`3198000${i}`, from)).status, 404, `address ${i + 1}`);
  }
  const seventh = await lookup('31000001', '2001:db8:aaaa:bbbb:ffff::9');
  assert.equal(seventh.status, 429, 'a seventh address in the same /64 shares the budget');

  // A different /64 is a different network.
  assert.equal((await lookup('31000001', '2001:db8:cccc:dddd::1')).status, 200);
});

test('a phone number cannot be ground down by trying from many addresses at once', { skip }, async () => {
  const on = await call('PATCH', '/api/settings', { passbookPhoneCheck: true }, { auth: superToken });
  assert.equal(on.status, 200, JSON.stringify(on.body));

  // Four wrong numbers for David's passbook, each from a different address. No single address has
  // done anything unusual.
  for (let i = 0; i < 4; i += 1) {
    const res = await lookup('31000004', `203.0.113.${i + 1}`, `07000000${i}0`);
    assert.equal(res.status, 401, `address ${i + 1}`);
  }
  // Now the right number, from an address nobody has seen: the passbook is locked for that ID.
  const locked = await lookup('31000004', '203.0.113.99', '0711000004');
  assert.equal(locked.status, 429, 'the lock is on the number, not the address');

  // Somebody else's passbook is untouched.
  const other = await lookup('31000002', '203.0.113.99', '0711000002');
  assert.equal(other.status, 200, JSON.stringify(other.body));

  const off = await call('PATCH', '/api/settings', { passbookPhoneCheck: false }, { auth: superToken });
  assert.equal(off.status, 200);
});

// ---------------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------------

test('a pass is not an office session, and an office session is not a pass', { skip }, async () => {
  const opened = await lookup('31000002', '192.0.2.10');
  const pass = opened.body.memberToken;
  assert.ok(pass);

  // The pass as an office bearer token: refused.
  const asOffice = await call('GET', '/api/auth/me', undefined, { auth: pass });
  assert.equal(asOffice.status, 401);

  // An office session as a pass: refused, on every route that takes a pass.
  for (const route of ['/api/public/documents', '/api/public/minutes', '/api/public/constitution']) {
    const res = await call('GET', route, undefined, { headers: { 'X-Member-Token': adminToken } });
    assert.equal(res.status, 401, route);
  }

  // A pass that was tampered with.
  const forged = pass.slice(0, -4) + (pass.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  const bad = await call('GET', '/api/public/documents', undefined, { headers: { 'X-Member-Token': forged } });
  assert.equal(bad.status, 401);

  // The real one works.
  const ok = await call('GET', '/api/public/documents', undefined, { headers: { 'X-Member-Token': pass } });
  assert.equal(ok.status, 200);
});

test('a member who leaves loses his pass at once, not at expiry', { skip }, async () => {
  const opened = await lookup('31000003', '192.0.2.11');
  const headers = { 'X-Member-Token': opened.body.memberToken };
  assert.equal((await call('GET', '/api/public/documents', undefined, { headers })).status, 200);

  await Member.updateOne({ nationalId: '31000003' }, { $set: { active: false } });
  const after = await call('GET', '/api/public/documents', undefined, { headers });
  assert.equal(after.status, 401);
  assert.equal(after.body.sessionEnded, true);
  await Member.updateOne({ nationalId: '31000003' }, { $set: { active: true } });
});

test('the passbook and the papers are never stored by a browser; the group totals may be', { skip }, async () => {
  const opened = await lookup('31000001', '192.0.2.12');
  assert.match(opened.headers.get('cache-control') || '', /no-store/);

  const headers = { 'X-Member-Token': opened.body.memberToken };
  for (const route of ['/api/public/documents', '/api/public/minutes', '/api/public/lookup/statement']) {
    const res = await fetch(`${base}${route}`, { headers });
    assert.match(res.headers.get('cache-control') || '', /no-store/, route);
    await res.arrayBuffer();
  }

  const overview = await call('GET', '/api/public/overview');
  assert.doesNotMatch(overview.headers.get('cache-control') || '', /no-store/);
});

// ---------------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------------

test('the disciplinary officer gets neither the ID nor the whole phone number', { skip }, async () => {
  const list = await call('GET', '/api/members?limit=50', undefined, { auth: disciplinaryToken });
  assert.equal(list.status, 200);
  assert.equal(list.body.members.length, MEMBERS.length);
  for (const m of list.body.members) {
    assert.equal(m.nationalId, undefined, 'the ID is half the key to a passbook');
    assert.match(m.phone, /XX/, 'the phone is masked');
    assert.ok(m.name && m.regNumber, 'what he needs to pick the right member is still there');
  }

  // Part of a phone or an ID would give them back one digit at a time.
  for (const search of ['0711', '3100', '31000']) {
    const res = await call('GET', `/api/members?search=${search}`, undefined, { auth: disciplinaryToken });
    assert.equal(res.body.members.length, 0, `searching "${search}" must not narrow towards a credential`);
  }
  // Typed in full - something he can only do if he already has it - it still finds the member.
  const byPhone = await call('GET', '/api/members?search=0711000001', undefined, { auth: disciplinaryToken });
  assert.equal(byPhone.body.members.length, 1);
  // Names and registration numbers search as they always did.
  const byName = await call('GET', '/api/members?search=alice', undefined, { auth: disciplinaryToken });
  assert.equal(byName.body.members.length, 1);
});

test('the office finds a member by the first digits of his ID, which it could not before', { skip }, async () => {
  for (const search of ['1234', '12345', '123456', '12 345', '12345678']) {
    const res = await call('GET', `/api/members?search=${encodeURIComponent(search)}`, undefined, { auth: adminToken });
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.members.map((m) => m.name),
      ['Esther Mwende'],
      `searching "${search}"`
    );
  }
});

// ---------------------------------------------------------------------------------
// What the super admin is told
// ---------------------------------------------------------------------------------

test('failed tries are recorded without the number, and only the super admin can read them', { skip }, async () => {
  const events = await SecurityEvent.find({ kind: 'gate_failed' }).lean();
  assert.ok(events.length > 10, 'the failures above were recorded');
  assert.ok(events.some((e) => e.reason === 'wrong_phone'));
  assert.ok(events.some((e) => e.reason === 'no_such_member'));

  // The ID is the credential: what is stored is a one-way tag, never the number.
  const everything = JSON.stringify(events);
  assert.ok(!everything.includes('31999999'), 'the number that was tried is not in the record');
  assert.ok(!everything.includes('31000004'), 'nor is a real member\'s');
  assert.ok(events.every((e) => !e.target || e.target.length === 12));

  const refused = await call('GET', '/api/audit/oversight', undefined, { auth: adminToken });
  assert.equal(refused.status, 403);

  const read = await call('GET', '/api/audit/oversight', undefined, { auth: superToken });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.ok(read.body.lookups.failed > 10);
  // The member being aimed at is named for the super admin, and listed first.
  assert.equal(read.body.lookups.targets[0].memberName, 'David Kiprop');
  assert.ok(read.body.lookups.targets[0].reasons.includes('wrong_phone'));

  const attention = await call('GET', '/api/audit/attention', undefined, { auth: superToken });
  assert.ok(attention.body.failedLookups > 10);
  assert.equal(attention.body.passbookPhoneCheck, false, 'the dashboard can nudge the super admin to switch it on');
});
