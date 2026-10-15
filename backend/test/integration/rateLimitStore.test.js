// The database-backed rate limit store: does a limit survive what the old one could not?
//
// The in-memory counter was wiped by every restart, so five wrong passwords could be followed by
// five more as soon as the host recycled the process. These drive the store against a real
// MongoDB, including the property that matters most the other way round: when the database cannot
// be reached the limiter keeps counting in memory instead of taking sign-in down with it.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-ratelimit';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(
    `TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run. ` +
      'Name it with "rehearsal", "scratch" or "test" in it.'
  );
}

const { DatabaseStore } = require('../../src/middleware/rateLimitStore');

const make = (prefix, windowMs = 60000, extra = {}) => {
  const store = new DatabaseStore({ prefix, ...extra });
  store.init({ windowMs });
  return store;
};

test.before(async () => {
  if (skip) return;
  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
});

test.after(async () => {
  if (skip) return;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test('every request in a window is counted, and a different key is counted apart', { skip }, async () => {
  const store = make('count');
  assert.equal((await store.increment('a')).totalHits, 1);
  assert.equal((await store.increment('a')).totalHits, 2);
  assert.equal((await store.increment('a')).totalHits, 3);
  assert.equal((await store.increment('b')).totalHits, 1);
});

test('two limiters sharing an address do not count against each other', { skip }, async () => {
  const login = make('login');
  const lookup = make('lookup');
  await login.increment('1.2.3.4');
  await login.increment('1.2.3.4');
  assert.equal((await lookup.increment('1.2.3.4')).totalHits, 1);
});

test('requests landing together are all counted', { skip }, async () => {
  const store = make('burst');
  await Promise.all(Array.from({ length: 20 }, () => store.increment('k')));
  assert.equal((await store.increment('k')).totalHits, 21);
});

test('the count survives a new store over the same database, which is what a restart is', { skip }, async () => {
  await make('restart').increment('k');
  await make('restart').increment('k');
  const afterRestart = make('restart');
  assert.equal((await afterRestart.increment('k')).totalHits, 3);
});

test('a window that is over starts again at one', { skip }, async () => {
  const store = make('expiry', 150);
  assert.equal((await store.increment('k')).totalHits, 1);
  assert.equal((await store.increment('k')).totalHits, 2);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal((await store.increment('k')).totalHits, 1);
});

test('a successful request can be given its try back, and a key can be cleared', { skip }, async () => {
  const store = make('give-back');
  await store.increment('k');
  await store.increment('k');
  await store.decrement('k');
  assert.equal((await store.increment('k')).totalHits, 2);

  await store.resetKey('k');
  assert.equal((await store.increment('k')).totalHits, 1);
});

test('the window reports when it ends', { skip }, async () => {
  const store = make('reset-time', 5000);
  const hit = await store.increment('k');
  const left = new Date(hit.resetTime).getTime() - Date.now();
  assert.ok(left > 3000 && left <= 5000, `resets in ${left}ms`);
});

test('with no database the limiter keeps counting in memory instead of failing', async () => {
  const store = make('offline', 60000, { isConnected: () => false });
  assert.equal((await store.increment('k')).totalHits, 1);
  assert.equal((await store.increment('k')).totalHits, 2);
  await store.decrement('k');
  assert.equal((await store.increment('k')).totalHits, 2);
  await store.resetKey('k');
  assert.equal((await store.increment('k')).totalHits, 1);
});

test('a database that errors is the same as no database: counted in memory, never thrown', async () => {
  const broken = {
    findOneAndUpdate: async () => {
      throw new Error('connection reset');
    },
    updateOne: async () => {
      throw new Error('connection reset');
    },
    deleteOne: async () => {
      throw new Error('connection reset');
    },
  };
  const store = make('broken', 60000, { isConnected: () => true, getCollection: () => broken });
  assert.equal((await store.increment('k')).totalHits, 1);
  assert.equal((await store.increment('k')).totalHits, 2);
  await assert.doesNotReject(() => store.decrement('k'));
  await assert.doesNotReject(() => store.resetKey('k'));
});
