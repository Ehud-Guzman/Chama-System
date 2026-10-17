// Emailing a member his statement, end to end: the real endpoint, a real database, and a stand-in for
// the mail provider's HTTPS API so nothing is ever sent to anybody.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';
process.env.FINE_EMAILS = 'off';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);
if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(`TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run.`);
}

const app = require('../../src/app');
const Member = require('../../src/models/Member');
const User = require('../../src/models/User');
const AuditLog = require('../../src/models/AuditLog');
const { invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds } = require('../../src/utils/ledgerTypes');

let server;
let base;
let tokens = {};
let withEmail;
let noEmail;
let optedOut;
const sent = [];
let realFetch;

const sign = (id, role) => jwt.sign({ id, role, scope: 'session' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const post = (route, token) =>
  realFetch(`${base}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });

test.before(async () => {
  if (skip) return;
  await mongoose.connect(targetFor('chama-rehearsal-statement-email'), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  invalidateSettings();
  await seedLedgerTypes();
  await seedGroupFunds();

  const hash = await bcrypt.hash('rehearsal-password1', 10);
  const make = (name, role) => User.create({ name, email: `${role}@example.com`, password: hash, role });
  tokens = {
    admin: sign((await make('Admin', 'admin'))._id, 'admin'),
    treasurer: sign((await make('Treasurer', 'treasurer'))._id, 'treasurer'),
    secretary: sign((await make('Secretary', 'secretary'))._id, 'secretary'),
  };
  withEmail = await Member.create({ name: 'Mary Mailed', phone: '0712000201', regNumber: 'E/1', nationalId: '40000001', email: 'mary@example.com' });
  noEmail = await Member.create({ name: 'Nick NoMail', phone: '0712000202', regNumber: 'E/2', nationalId: '40000002' });
  optedOut = await Member.create({ name: 'Olive OptedOut', phone: '0712000203', regNumber: 'E/3', nationalId: '40000003', email: 'olive@example.com', emailNotifications: false });

  process.env.MAIL_API_PROVIDER = 'brevo';
  process.env.MAIL_API_KEY = 'test-key';
  process.env.MAIL_FROM = 'Chama <chama@example.test>';
  delete process.env.SMTP_HOST;

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // Only the provider's address is faked; the test's own calls to the app go through.
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.brevo.com/')) {
      sent.push({ url: String(url), body: JSON.parse(options.body) });
      return { ok: true, status: 201, text: async () => JSON.stringify({ messageId: '<test@brevo>' }) };
    }
    return realFetch(url, options);
  };
});

test.after(async () => {
  if (skip) return;
  globalThis.fetch = realFetch;
  server?.close();
  delete process.env.MAIL_API_PROVIDER;
  delete process.env.MAIL_API_KEY;
  delete process.env.MAIL_FROM;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('a statement is mailed as a real PDF to the address on his record, and the send is recorded', { skip }, async () => {
  const res = await post(`/api/members/${withEmail._id}/statement/email`, tokens.treasurer);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal((await res.json()).to, 'mary@example.com');

  assert.equal(sent.length, 1);
  const body = sent[0].body;
  assert.deepEqual(body.to, [{ email: 'mary@example.com' }]);
  assert.match(body.subject, /your statement/);
  assert.equal(body.attachment.length, 1);
  assert.match(body.attachment[0].name, /^statement-E-1\.pdf$/);
  const pdf = Buffer.from(body.attachment[0].content, 'base64');
  assert.equal(pdf.slice(0, 4).toString(), '%PDF', 'the attachment is a PDF');
  assert.ok(pdf.length > 1000);

  const entry = await AuditLog.findOne({ entityType: 'Notification', 'after.kind': 'statement' });
  assert.ok(entry, 'who sent what to whom is in the audit trail');
  assert.equal(entry.after.to, 'mary@example.com');
});

test('a period narrows what is mailed, and a bad one is refused before anything is sent', { skip }, async () => {
  sent.length = 0;
  const bad = await post(`/api/members/${withEmail._id}/statement/email?year=2026&quarter=9`, tokens.admin);
  assert.equal(bad.status, 400);
  assert.equal(sent.length, 0);

  const ok = await post(`/api/members/${withEmail._id}/statement/email?range=this-year`, tokens.admin);
  assert.equal(ok.status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.textContent, /It covers: /);
});

test('no address, or emails switched off, is told plainly and nothing is sent', { skip }, async () => {
  sent.length = 0;
  const none = await post(`/api/members/${noEmail._id}/statement/email`, tokens.treasurer);
  assert.equal(none.status, 400);
  assert.match((await none.json()).message, /no usable email address/);

  const off = await post(`/api/members/${optedOut._id}/statement/email`, tokens.treasurer);
  assert.equal(off.status, 400);
  assert.match((await off.json()).message, /switched email off/);
  assert.equal(sent.length, 0);
});

test('no more than three a day to one member', { skip }, async () => {
  sent.length = 0;
  // Two were sent above; one more is allowed, the next is not.
  assert.equal((await post(`/api/members/${withEmail._id}/statement/email`, tokens.treasurer)).status, 200);
  const blocked = await post(`/api/members/${withEmail._id}/statement/email`, tokens.treasurer);
  assert.equal(blocked.status, 429);
  assert.equal(sent.length, 1);
});

test('only the roles that keep the register can send one', { skip }, async () => {
  assert.equal((await post(`/api/members/${withEmail._id}/statement/email`, tokens.secretary)).status, 403);
  assert.equal((await realFetch(`${base}/api/members/${withEmail._id}/statement/email`, { method: 'POST' })).status, 401);
});

test('with mail not set up the refusal says so and nothing is attempted', { skip }, async () => {
  sent.length = 0;
  const saved = { p: process.env.MAIL_API_PROVIDER, k: process.env.MAIL_API_KEY };
  delete process.env.MAIL_API_KEY;
  delete process.env.MAIL_API_PROVIDER;
  try {
    const res = await post(`/api/members/${noEmail._id}/statement/email`, tokens.treasurer);
    assert.equal(res.status, 503);
    assert.match((await res.json()).message, /not set up/i);
    assert.equal(sent.length, 0);
  } finally {
    process.env.MAIL_API_PROVIDER = saved.p;
    process.env.MAIL_API_KEY = saved.k;
  }
});
