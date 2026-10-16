// The Control Room's plain-module pieces, and the one place the HTTP client changed for it.
//
// The screens themselves are exercised by hand; what is pinned here is what could go quietly wrong:
// a relative time that says "yesterday" for the wrong day, an audit diff that hides the field that
// moved, and the closed-books prompt — which must retry the same request exactly once, with the
// reason attached and percent-encoded, and must never prompt a role that was not offered it.
//
//   npm test        (in frontend/)
import test from 'node:test';
import assert from 'node:assert/strict';

import api, { setOverrideHandler } from '../src/services/api.js';
import { timeAgo, uptimeText } from '../src/utils/timeAgo.js';
import { changedFields, showValue } from '../src/utils/auditDiff.js';

const NOW = new Date('2026-10-16T12:00:00Z').getTime();
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('relative times are coarse and say never when there is nothing', () => {
  assert.equal(timeAgo(null, NOW), 'never');
  assert.equal(timeAgo('not a date', NOW), 'never');
  assert.equal(timeAgo(ago(20 * 1000), NOW), 'just now');
  assert.equal(timeAgo(ago(MIN), NOW), '1 minute ago');
  assert.equal(timeAgo(ago(45 * MIN), NOW), '45 minutes ago');
  assert.equal(timeAgo(ago(HOUR), NOW), '1 hour ago');
  assert.equal(timeAgo(ago(5 * HOUR), NOW), '5 hours ago');
  assert.equal(timeAgo(ago(DAY + HOUR), NOW), 'yesterday');
  assert.equal(timeAgo(ago(12 * DAY), NOW), '12 days ago');
  assert.equal(timeAgo(ago(90 * DAY), NOW), '3 months ago');
  // A clock a little ahead of the server's must not print a negative age.
  assert.equal(timeAgo(new Date(NOW + 5 * MIN).toISOString(), NOW), 'just now');
});

test('uptime reads as days and hours, or hours and minutes, or minutes', () => {
  assert.equal(uptimeText(90), '1 min');
  assert.equal(uptimeText(3 * 3600 + 5 * 60), '3 h 5 min');
  assert.equal(uptimeText(2 * 86400 + 4 * 3600), '2 days 4 h');
  assert.equal(uptimeText(86400), '1 day 0 h');
  assert.equal(uptimeText(undefined), '0 min');
});

test('the audit diff lists only the fields that moved, and ignores the noise', () => {
  const before = { name: 'Joseph', phone: '0700000001', updatedAt: '2026-01-01', family: { children: ['A'] } };
  const after = { name: 'Joseph', phone: '0700000002', updatedAt: '2026-02-02', family: { children: ['A', 'B'] } };
  const rows = changedFields(before, after);
  assert.deepEqual(rows.map((r) => r.field), ['family', 'phone']);
  assert.equal(rows.find((r) => r.field === 'phone').from, '0700000001');
  assert.equal(rows.find((r) => r.field === 'phone').to, '0700000002');
});

test('a creation or a deletion shows every field of the side that exists', () => {
  assert.deepEqual(changedFields(null, { a: 1, b: 2 }).map((r) => r.field), ['a', 'b']);
  assert.deepEqual(changedFields({ a: 1 }, null).map((r) => r.field), ['a']);
  assert.deepEqual(changedFields(null, null), []);
  assert.deepEqual(changedFields({ a: 1 }, { a: 1 }), []);
  // null and undefined are the same "nothing", so a field that was never there is not a change.
  assert.deepEqual(changedFields({ a: null }, {}), []);
});

test('values print as one short line', () => {
  assert.equal(showValue(undefined), '—');
  assert.equal(showValue(null), 'empty');
  assert.equal(showValue(''), 'empty');
  assert.equal(showValue('hello'), 'hello');
  assert.equal(showValue(0), '0');
  assert.equal(showValue(false), 'false');
  assert.ok(showValue({ x: 'y'.repeat(300) }).length <= 140);
});

// --- the closed-books prompt -----------------------------------------------------------------------

function respond({ status = 200, body = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: (key) => (key.toLowerCase() === 'content-type' ? 'application/json' : null),
      forEach: (fn) => fn('application/json', 'content-type'),
    },
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([JSON.stringify(body)]),
  };
}

const LOCKED = {
  status: 423,
  body: { message: 'The books are closed up to 2026-10-04.', code: 'period_locked', canOverride: true, lockedThrough: '2026-10-04' },
};

function scriptedFetch(responses) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return respond(responses.shift());
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

test('a locked save asks for a reason, then repeats the same request once with it attached', async () => {
  const fetchLog = scriptedFetch([LOCKED, { status: 200, body: { ok: true } }]);
  const asked = [];
  const off = setOverrideHandler(async (details) => {
    asked.push(details);
    return 'Receipt 0412 was 600 — not 500';
  });
  try {
    const res = await api.patch('/api/contributions/abc', { amount: 600 });
    assert.equal(res.status, 200);
    assert.equal(fetchLog.calls.length, 2);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].lockedThrough, '2026-10-04');
    // The same request again...
    assert.equal(fetchLog.calls[1].url, fetchLog.calls[0].url);
    assert.equal(fetchLog.calls[1].options.body, fetchLog.calls[0].options.body);
    assert.equal(fetchLog.calls[1].options.method, 'PATCH');
    // ...with the reason, percent-encoded because a header cannot carry every character.
    assert.equal(
      decodeURIComponent(fetchLog.calls[1].options.headers['X-Override-Reason']),
      'Receipt 0412 was 600 — not 500'
    );
    assert.equal(fetchLog.calls[0].options.headers['X-Override-Reason'], undefined);
  } finally {
    off();
    fetchLog.restore();
  }
});

test('declining the prompt leaves the refusal as the error it was', async () => {
  const fetchLog = scriptedFetch([LOCKED]);
  const off = setOverrideHandler(async () => null);
  try {
    await assert.rejects(api.delete('/api/contributions/abc'), (err) => err.response?.status === 423);
    assert.equal(fetchLog.calls.length, 1, 'nothing was sent a second time');
  } finally {
    off();
    fetchLog.restore();
  }
});

test('a role that was not offered the override is never prompted', async () => {
  const fetchLog = scriptedFetch([{ status: 423, body: { ...LOCKED.body, canOverride: false } }]);
  let prompted = false;
  const off = setOverrideHandler(async () => {
    prompted = true;
    return 'let me in';
  });
  try {
    await assert.rejects(api.patch('/api/contributions/abc', { amount: 1 }), (err) => err.response?.status === 423);
    assert.equal(prompted, false);
    assert.equal(fetchLog.calls.length, 1);
  } finally {
    off();
    fetchLog.restore();
  }
});

test('the retry is made once: a second refusal is not asked about again', async () => {
  const fetchLog = scriptedFetch([LOCKED, LOCKED]);
  let asks = 0;
  const off = setOverrideHandler(async () => {
    asks += 1;
    return 'a perfectly good reason';
  });
  try {
    await assert.rejects(api.patch('/api/contributions/abc', { amount: 1 }), (err) => err.response?.status === 423);
    assert.equal(asks, 1);
    assert.equal(fetchLog.calls.length, 2);
  } finally {
    off();
    fetchLog.restore();
  }
});

test('with no handler registered a locked save is simply an error', async () => {
  const fetchLog = scriptedFetch([LOCKED]);
  try {
    await assert.rejects(api.patch('/api/contributions/abc', { amount: 1 }), (err) => err.response?.status === 423);
    assert.equal(fetchLog.calls.length, 1);
  } finally {
    fetchLog.restore();
  }
});

// --- refusals that are decisions, and a preview that runs out ----------------------------------------

test('a maintenance refusal is never kept in the outbox to be replayed later', async () => {
  const fetchLog = scriptedFetch([{ status: 503, body: { message: 'In maintenance', code: 'maintenance' } }]);
  try {
    // `offlineQueue` is the opt-in the ledger's own saves use; a 503 would normally be kept.
    const err = await api
      .post('/api/ledger/members/abc/log', { amount: 100 }, { offlineQueue: true, offlineLabel: 'payment' })
      .then(() => null, (e) => e);
    assert.equal(err.response.status, 503);
    assert.notEqual(err.queuedOffline, true, 'told "will send" about something that was refused on purpose');
  } finally {
    fetchLog.restore();
  }
});

test('a preview that expires puts the real session back instead of signing out', async () => {
  const store = new Map([
    ['cm_token', 'preview-token'],
    ['cm_real_token', 'real-token'],
  ]);
  const moves = [];
  const savedWindow = globalThis.window;
  const savedStorage = globalThis.localStorage;
  globalThis.window = { location: { pathname: '/admin/members', assign: (to) => moves.push(to) } };
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  const fetchLog = scriptedFetch([{ status: 401, body: { message: 'Session expired' } }, { status: 401, body: { message: 'Session expired' } }]);
  try {
    await assert.rejects(api.get('/api/members'), (err) => err.response?.status === 401);
    assert.equal(store.get('cm_token'), 'real-token');
    assert.equal(store.has('cm_real_token'), false);
    assert.deepEqual(moves, ['/admin/control']);

    // With nothing parked, a 401 is a real end of session.
    await assert.rejects(api.get('/api/members'), (err) => err.response?.status === 401);
    assert.equal(store.has('cm_token'), false);
    assert.deepEqual(moves, ['/admin/control', '/admin/login']);
  } finally {
    fetchLog.restore();
    globalThis.window = savedWindow;
    globalThis.localStorage = savedStorage;
    if (savedWindow === undefined) delete globalThis.window;
    if (savedStorage === undefined) delete globalThis.localStorage;
  }
});
