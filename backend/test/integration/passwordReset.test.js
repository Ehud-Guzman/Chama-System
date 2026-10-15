// Forgotten passwords, end to end.
//
// Until now the only way back in was another admin resetting your password, which leaves the only
// admin with nobody to ask. These pin the self-service road and the ways it must not leak: the
// same answer whether or not the address has an account, a link that works once and expires, only
// a hash of it stored, and every older session ended when it is used.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';
process.env.FRONTEND_URL = 'https://chama.example.org,http://localhost:5173';
// This suite makes more failed reset attempts in a minute than the real limit allows; the limiter itself is not what it tests.
process.env.LOGIN_RATE_LIMIT_MAX = '100';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB - run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-passwordreset';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(
    `TEST_MONGO_URI (${URI}) does not look like a scratch database - refusing to run. ` +
      'Name it with "rehearsal", "scratch" or "test" in it.'
  );
}

// Mail is replaced before the app loads, because the controller takes its functions at require
// time. Whatever mail configuration this machine has, nothing is ever sent to anybody: every message
// the app tries to send lands in `sent`.
const mailer = require('../../src/utils/mailer');
const sent = [];
mailer.sendMail = async (message) => {
  sent.push(message);
};
mailer.isMailConfigured = () => true;

const app = require('../../src/app');
const User = require('../../src/models/User');

let server;
let base;

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

async function waitForMail(count) {
  for (let i = 0; i < 100 && sent.length < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const tokenFrom = (message) => /token=([0-9a-f]{64})/.exec(message.text)[1];

test.before(async () => {
  if (skip) return;
  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  await User.create({
    name: 'Mary Wanjiku',
    email: 'mary@example.com',
    password: await bcrypt.hash('old-password-1', 10),
    role: 'admin',
    active: true,
  });
  await User.create({
    name: 'Gone Away',
    email: 'gone@example.com',
    password: await bcrypt.hash('old-password-1', 10),
    role: 'admin',
    active: false,
  });

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

test('the sign-in page is told whether the link can work at all', { skip }, async () => {
  const res = await call('GET', '/api/auth/password-reset/available');
  assert.equal(res.status, 200);
  assert.equal(res.body.available, true);
});

test('an address with no account, and a deactivated one, get the same answer and no email', { skip }, async () => {
  const known = await call('POST', '/api/auth/forgot-password', { email: 'nobody@example.com' });
  const gone = await call('POST', '/api/auth/forgot-password', { email: 'gone@example.com' });
  const blank = await call('POST', '/api/auth/forgot-password', {});
  assert.equal(known.status, 200);
  assert.equal(gone.status, 200);
  assert.equal(blank.status, 200);
  assert.equal(known.body.message, gone.body.message);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(sent.length, 0, 'nothing was mailed to anybody');
});

test('a real account is mailed a link, and only a hash of its token is kept', { skip }, async () => {
  const unknown = await call('POST', '/api/auth/forgot-password', { email: 'nobody@example.com' });
  const res = await call('POST', '/api/auth/forgot-password', { email: 'Mary@Example.com ' });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, unknown.body.message, 'indistinguishable from an unknown address');

  await waitForMail(1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'mary@example.com');
  assert.match(sent[0].text, /^Hi Mary,/);
  // The live address, not the localhost one in the same list.
  assert.match(sent[0].text, /https:\/\/chama\.example\.org\/admin\/reset-password\?token=[0-9a-f]{64}/);

  const token = tokenFrom(sent[0]);
  const stored = await User.findOne({ email: 'mary@example.com' }).select('+resetTokenHash +resetTokenExpires').lean();
  assert.notEqual(stored.resetTokenHash, token, 'the token itself is not stored');
  assert.equal(stored.resetTokenHash.length, 64);
  const minutes = (new Date(stored.resetTokenExpires).getTime() - Date.now()) / 60000;
  assert.ok(minutes > 28 && minutes <= 30, `lasts ${minutes} minutes`);
});

test('a link that is wrong, or a password that is weak, changes nothing', { skip }, async () => {
  const token = tokenFrom(sent[0]);

  const wrong = await call('POST', '/api/auth/reset-password', { token: 'f'.repeat(64), password: 'brand-new-pw-9' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.message, /expired or was already used/);

  const weak = await call('POST', '/api/auth/reset-password', { token, password: 'short' });
  assert.equal(weak.status, 400);
  const lettersOnly = await call('POST', '/api/auth/reset-password', { token, password: 'onlyletterspassword' });
  assert.equal(lettersOnly.status, 400);

  const stillOld = await call('POST', '/api/auth/login', { email: 'mary@example.com', password: 'old-password-1' });
  assert.equal(stillOld.status, 200, 'the old password still works');
});

test('the link sets a new password once, ends older sessions, and cannot be used again', { skip }, async () => {
  const token = tokenFrom(sent[0]);
  const oldSession = (await call('POST', '/api/auth/login', { email: 'mary@example.com', password: 'old-password-1' })).body.token;
  assert.equal((await call('GET', '/api/auth/me', undefined, oldSession)).status, 200);

  // `iat` has one-second resolution, so the reset has to land in a later second than the sign-in.
  await new Promise((resolve) => setTimeout(resolve, 2100));

  const done = await call('POST', '/api/auth/reset-password', { token, password: 'brand-new-pw-9' });
  assert.equal(done.status, 200, JSON.stringify(done.body));

  assert.equal((await call('GET', '/api/auth/me', undefined, oldSession)).status, 401, 'the old session is over');
  const fresh = await call('POST', '/api/auth/login', { email: 'mary@example.com', password: 'brand-new-pw-9' });
  assert.equal(fresh.status, 200, 'the new password works');
  assert.equal((await call('POST', '/api/auth/login', { email: 'mary@example.com', password: 'old-password-1' })).status, 401);

  const again = await call('POST', '/api/auth/reset-password', { token, password: 'another-pw-77' });
  assert.equal(again.status, 400, 'a link works once');
  const stored = await User.findOne({ email: 'mary@example.com' }).select('+resetTokenHash').lean();
  assert.equal(stored.resetTokenHash, '');
});

test('an old link stops working: asking again replaces it, and time runs it out', { skip }, async () => {
  await call('POST', '/api/auth/forgot-password', { email: 'mary@example.com' });
  await waitForMail(2);
  await call('POST', '/api/auth/forgot-password', { email: 'mary@example.com' });
  await waitForMail(3);
  const first = tokenFrom(sent[1]);
  const second = tokenFrom(sent[2]);
  assert.notEqual(first, second);

  const replaced = await call('POST', '/api/auth/reset-password', { token: first, password: 'brand-new-pw-8' });
  assert.equal(replaced.status, 400, 'the earlier link was replaced');

  await User.updateOne({ email: 'mary@example.com' }, { $set: { resetTokenExpires: new Date(Date.now() - 1000) } });
  const expired = await call('POST', '/api/auth/reset-password', { token: second, password: 'brand-new-pw-8' });
  assert.equal(expired.status, 400, 'the later one ran out');
});
