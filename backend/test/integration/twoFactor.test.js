// Two-factor authentication as a group decision: the master switch, end to end.
//
// The switch exists so the committee can have the feature built without the feature being in use.
// What has to be proved is that "off" really means off - including for an account that had already
// enrolled, which is the state that matters when somebody flips it off after a fortnight of use. So
// these tests drive the real endpoints against a real database: enrol an account properly with a
// real TOTP code, then check what sign-in does with the switch off and on.
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

const TEST_DB = 'chama-rehearsal-twofactor';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(
    `TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run. ` +
      'Name it with "rehearsal", "scratch" or "test" in it.'
  );
}

const app = require('../../src/app');
const User = require('../../src/models/User');
const { totp } = require('../../src/utils/totp');
const { getOrCreateSettings, invalidateSettings } = require('../../src/utils/settings');

let server;
let base;
let superToken;
let adminToken;
let adminId;

const api = (method, route, body, token) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const post = async (route, body, token) => {
  const res = await api('POST', route, body, token);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// The replay guard means a code that has been accepted once cannot be accepted again - which is the
// point of it, and it is why these tests cannot simply reuse `totp(secret)` for the next step.
//
// Rather than sleeping thirty seconds per assertion, this clears the account's recorded slot, which
// is exactly what the passage of a thirty-second window does. It is a deliberate nudge to the
// clock, not a way around the guard: the guard itself is asserted in its own right below.
async function allowNextCode() {
  await User.updateOne({ _id: adminId }, { $set: { 'twoFactor.lastUsedStep': null } });
  const user = await User.findById(adminId).select('+twoFactor.secret');
  return user.twoFactor.secret;
}


test.before(async () => {
  if (skip) return;

  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  // The default has to be OFF: that is what "built but not in use" means.
  const settings = await getOrCreateSettings();
  assert.equal(
    settings.twoFactorAuthEnabled,
    false,
    'two-factor authentication must default to off'
  );
  invalidateSettings();

  const admin = await User.create({
    name: 'Switch Admin',
    email: 'switch-admin@example.com',
    password: await bcrypt.hash('rehearsal-password', 10),
    role: 'admin',
    active: true,
  });
  adminId = admin._id;

  await User.create({
    name: 'Switch Super',
    email: 'switch-super@example.com',
    password: await bcrypt.hash('rehearsal-password', 10),
    role: 'super_admin',
    active: true,
  });

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const signIn = async (email) => {
    const res = await api('POST', '/api/auth/login', { email, password: 'rehearsal-password' });
    const body = await res.json();
    assert.equal(res.status, 200, `${email} could not sign in`);
    return body.token;
  };
  superToken = await signIn('switch-super@example.com');
  adminToken = await signIn('switch-admin@example.com');
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------------
// Off by default
// ---------------------------------------------------------------------------------

test('with the switch off, nobody can enrol — and the API says why', { skip }, async () => {
  const setup = await post('/api/auth/me/2fa/setup', {}, adminToken);
  assert.equal(setup.status, 403);
  // The message names who can change it, because the person reading it is an admin who has just
  // been told no.
  assert.match(setup.body.message, /switched off/);
  assert.match(setup.body.message, /super admin/);

  // And the state is reported honestly on the endpoint the panel reads.
  const me = await api('GET', '/api/auth/me', undefined, adminToken);
  const meBody = await me.json();
  assert.equal(meBody.twoFactorAuthEnabled, false);
  assert.equal(meBody.user.twoFactorEnabled, false);
});

test('only the super admin can flip the switch', { skip }, async () => {
  const refused = await api('PATCH', '/api/settings', { twoFactorAuthEnabled: true }, adminToken);
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).message, /super admin/i);

  // A malformed value is refused too, rather than being coerced into something surprising.
  const bad = await api('PATCH', '/api/settings', { twoFactorAuthEnabled: 'yes' }, superToken);
  assert.equal(bad.status, 400);
});

test('switched on, an account can enrol with a real code', { skip }, async () => {
  const on = await api('PATCH', '/api/settings', { twoFactorAuthEnabled: true }, superToken);
  assert.equal(on.status, 200);
  assert.equal((await on.json()).settings.twoFactorAuthEnabled, true);

  const setup = await post('/api/auth/me/2fa/setup', {}, adminToken);
  assert.equal(setup.status, 200);
  assert.match(setup.body.secret, /^[A-Z2-7]{32}$/);

  // The wrong code is refused...
  const wrong = await post('/api/auth/me/2fa/enable', { code: '000000' }, adminToken);
  assert.equal(wrong.status, 400);

  // ...and the right one switches it on, handing back recovery codes exactly once.
  const enabled = await post('/api/auth/me/2fa/enable', { code: totp(setup.body.secret) }, adminToken);
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.user.twoFactorEnabled, true);
  assert.equal(enabled.body.recoveryCodes.length, 10);
});

test('switched on, sign-in is two steps and the code is checked', { skip }, async () => {
  const first = await post('/api/auth/login', {
    email: 'switch-admin@example.com',
    password: 'rehearsal-password',
  });
  assert.equal(first.status, 200);
  // The password alone is not a session any more.
  assert.equal(first.body.token, undefined);
  assert.equal(first.body.twoFactorRequired, true);

  // A wrong code does not sign anybody in.
  const wrong = await post('/api/auth/2fa/verify', { challenge: first.body.challenge, code: '123456' });
  assert.equal(wrong.status, 401);

  // The challenge is not a session either - the rest of the API refuses it.
  const asSession = await api('GET', '/api/auth/me', undefined, first.body.challenge);
  assert.equal(asSession.status, 401);

  // The code that turned the second factor ON cannot be reused to sign in: enabling recorded the
  // slot it belonged to. This is the replay guard doing its job.
  const secret = await User.findById(adminId).select('+twoFactor.secret');
  const replayed = await post('/api/auth/2fa/verify', {
    challenge: first.body.challenge,
    code: totp(secret.twoFactor.secret),
  });
  assert.equal(replayed.status, 401, 'a code already spent must not sign anybody in');

  // A code from the next window does, which is what a person waiting a moment would type.
  const freshSecret = await allowNextCode();
  const verified = await post('/api/auth/2fa/verify', {
    challenge: first.body.challenge,
    code: totp(freshSecret),
  });
  assert.equal(verified.status, 200);
  assert.ok(verified.body.token, 'a session token should come back');
});

// ---------------------------------------------------------------------------------
// Off again — the state that matters
// ---------------------------------------------------------------------------------

test('switching it off stops the challenge, even for an account already enrolled', { skip }, async () => {
  // The account is still enrolled. That enrolment is what "off" has to override.
  const enrolled = await User.findById(adminId);
  assert.equal(enrolled.twoFactor.enabled, true);

  const off = await api('PATCH', '/api/settings', { twoFactorAuthEnabled: false }, superToken);
  assert.equal(off.status, 200);

  // A password sign-in now returns a session outright - no challenge, no code. This is the whole
  // point of the switch: nobody is asked, and nobody is locked out.
  const signIn = await post('/api/auth/login', {
    email: 'switch-admin@example.com',
    password: 'rehearsal-password',
  });
  assert.equal(signIn.status, 200);
  assert.equal(signIn.body.twoFactorRequired, undefined);
  assert.ok(signIn.body.token, 'signing in with the password alone should work again');

  // The enrolment was kept, not deleted, so turning it back on restores exactly what was there.
  // (`secret` is `select: false` - the same rule that keeps it out of the admin list - so it has to
  // be asked for by name here.)
  const stillEnrolled = await User.findById(adminId).select('+twoFactor.secret');
  assert.equal(stillEnrolled.twoFactor.enabled, true);
  assert.ok(stillEnrolled.twoFactor.secret, 'the secret must survive the switch being off');
});

test('a challenge already in hand is refused once the switch is off', { skip }, async () => {
  // Turn it back on, start a sign-in, then flip the switch mid-flow. The challenge lives five
  // minutes, so this is not a hypothetical: somebody is half-way through when the decision changes.
  await api('PATCH', '/api/settings', { twoFactorAuthEnabled: true }, superToken);

  const first = await post('/api/auth/login', {
    email: 'switch-admin@example.com',
    password: 'rehearsal-password',
  });
  assert.equal(first.body.twoFactorRequired, true);

  await api('PATCH', '/api/settings', { twoFactorAuthEnabled: false }, superToken);

  const secret = await User.findById(adminId).select('+twoFactor.secret');
  const verified = await post('/api/auth/2fa/verify', {
    challenge: first.body.challenge,
    code: totp(secret.twoFactor.secret),
  });
  // Refused with a sentence that says what to do, rather than a code error that would have him
  // staring at his phone wondering why a correct code is being rejected.
  assert.equal(verified.status, 401);
  assert.match(verified.body.message, /switched off/i);
  assert.match(verified.body.message, /password/i);
});

test('an account can still turn its own second factor off while the group has it off', { skip }, async () => {
  // "Off" must not trap anybody: an account that wants out of it has to be able to get out even
  // when the group is not using the feature at all.
  const secret = await allowNextCode();
  const disabled = await post(
    '/api/auth/me/2fa/disable',
    { password: 'rehearsal-password', code: totp(secret) },
    adminToken
  );
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.user.twoFactorEnabled, false);

  const after = await User.findById(adminId).select('+twoFactor.secret');
  assert.equal(after.twoFactor.enabled, false);
  assert.equal(after.twoFactor.secret, '', 'the stored secret must be cleared, not left behind');
});

test('the super admin can clear another account’s second factor', { skip }, async () => {
  // A lost phone. The super admin resets it; the account signs in with a password alone, which is
  // why whoever does this should reset that password in the same sitting.
  await api('PATCH', '/api/settings', { twoFactorAuthEnabled: true }, superToken);

  const setup = await post('/api/auth/me/2fa/setup', {}, adminToken);
  assert.equal(setup.status, 200);
  // A brand-new secret, so its current code is one nothing has spent.
  const enabled = await post('/api/auth/me/2fa/enable', { code: totp(setup.body.secret) }, adminToken);
  assert.equal(enabled.status, 200);
  assert.equal((await User.findById(adminId)).twoFactor.enabled, true);

  const reset = await post(`/api/auth/admins/${adminId}/2fa/reset`, {}, superToken);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.wasEnabled, true);
  assert.equal((await User.findById(adminId)).twoFactor.enabled, false);

  // The reset is in the audit trail, naming who did it and for whom.
  const AuditLog = require('../../src/models/AuditLog');
  const entry = await AuditLog.findOne({ entityType: 'User', entityId: adminId }).sort({ createdAt: -1 });
  assert.match(JSON.stringify(entry.after), /two-factor authentication reset/);
});


