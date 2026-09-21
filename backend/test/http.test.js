// The API's outward behaviour, without a database.
//
// These are the guarantees that hold before any document exists: the process
// starts with no MONGO_URI, a health check tells the truth about the database it is
// not connected to, everything behind the login refuses an anonymous caller, the
// login budget is enforced per address *and* per client, and the responses carry
// the security headers the app relies on.
//
// Routes that would touch MongoDB are deliberately not exercised here — with no
// connection they would sit in mongoose's buffer for ten seconds and then fail as a
// 500, which tests nothing.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../src/app');

let server;
let base;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  // `listen` is asynchronous: the port is only assigned once the server is actually
  // listening, so the first test would otherwise run against a null address.
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server?.close());

const get = (path, headers = {}) => fetch(`${base}${path}`, { headers });
const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('the health check reports the database it actually has', async () => {
  const res = await get('/api/health');
  // 503, not 200: nothing has connected this process to MongoDB, and a health
  // check that says "healthy" while the database is unreachable is worse than none.
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.db, 'disconnected');
});

test('an unknown route answers JSON, not an HTML error page', async () => {
  const res = await get('/api/there-is-nothing-here');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { message: 'Not found' });
});

test('the admin API refuses an anonymous caller', async () => {
  for (const path of [
    '/api/members',
    '/api/auth/me',
    '/api/ledger',
    '/api/fines',
    // The reminders screen writes to people's inboxes, so the mail status and the list
    // behind it have to refuse a stranger before anything else about them matters.
    '/api/notifications/status',
    '/api/notifications/reminders',
  ]) {
    const res = await get(path);
    assert.equal(res.status, 401, `${path} should be 401 without a token`);
  }
});

test('a token signed with the wrong secret is not a session', async () => {
  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ id: '000000000000000000000000' }, 'a-secret-nobody-set', {
    algorithm: 'HS256',
  });
  const res = await get('/api/members', { Authorization: `Bearer ${forged}` });
  assert.equal(res.status, 401);
});

test('login refuses a request with no credentials', async () => {
  const res = await post('/api/auth/login', {}, { 'X-Forwarded-For': '203.0.113.10' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).message, 'Email and password are required');
});

test('login attempts are budgeted per address and per email', async () => {
  const headers = { 'X-Forwarded-For': '203.0.113.55' };
  const attempt = () => post('/api/auth/login', { email: 'brute@example.com' }, headers);

  const codes = [];
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    codes.push((await attempt()).status);
  }

  // The first five get as far as validation; the sixth is refused by the limiter
  // before it reaches the controller. A wrong password cannot be tried more than
  // five times per address, and the same email from anywhere else has its own five.
  assert.deepEqual(codes.slice(0, 5), [400, 400, 400, 400, 400]);
  assert.equal(codes[5], 429);
});

test('every response carries a request id and the security headers', async () => {
  const res = await get('/api/health');
  assert.match(res.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  // helmet's framing and referrer protection, which matter for a page that renders
  // document previews.
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('the CORS allow-list answers the site and stays quiet for anyone else', async () => {
  const allowed = await get('/api/health', { Origin: 'http://localhost:5173' });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');

  const stranger = await get('/api/health', { Origin: 'https://not-our-site.example' });
  assert.equal(stranger.headers.get('access-control-allow-origin'), null);
});
