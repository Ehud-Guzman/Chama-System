// The HTTP client, under node's own test runner.
//
// The frontend's other tests cover pure functions. This one covers the module every screen talks
// through, because it was rewritten from axios onto `fetch` and what other code depends on is not the
// request itself but the *shape* of what comes back: an error carrying `response: { status, data }`
// for every screen's message and for the offline queue's own classification, a blob error carrying a
// Blob for `utils/blobError` to unwrap, and a request config whose `data` is still the object the
// caller passed — the outbox stores and replays it.
//
//   npm test        (in frontend/)
import test from 'node:test';
import assert from 'node:assert/strict';

import api, { apiMessage } from '../src/services/api.js';
import { __test as queue } from '../src/services/offlineQueue.js';

// A Response shaped like the ones `fetch` resolves with, with only the parts the client reads.
function respond({ status = 200, body = '', type = 'application/json', headers = {} } = {}) {
  const all = { 'content-type': type, ...headers };
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: {
      get: (key) => all[key.toLowerCase()] ?? null,
      forEach: (fn) => Object.entries(all).forEach(([key, value]) => fn(value, key)),
    },
    text: async () => body,
    blob: async () => new Blob([body], { type }),
  };
}

// Replaces fetch for one test and hands back what the client sent.
function captureFetch(result) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (result instanceof Error) throw result;
    return typeof result === 'function' ? result(url, options) : result;
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function withToken(value) {
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => value, removeItem: () => {} };
  return () => {
    globalThis.localStorage = original;
  };
}

test('a GET puts its params in the query and drops the empty ones', async () => {
  const stub = captureFetch(respond({ body: '{"ok":true}' }));
  try {
    const res = await api.get('/api/members', { params: { status: 'active', download: undefined } });
    assert.equal(stub.calls[0].options.method, 'GET');
    assert.match(stub.calls[0].url, /\/api\/members\?status=active$/);
    assert.equal(res.data.ok, true);
    assert.equal(res.status, 200);
  } finally {
    stub.restore();
  }
});

test('the bearer token rides on every request, and FormData keeps its own content type', async () => {
  const stub = captureFetch(respond({}));
  const restore = withToken('session-token');
  try {
    await api.get('/api/reports/summary');
    assert.equal(stub.calls[0].options.headers.Authorization, 'Bearer session-token');

    const form = new FormData();
    form.append('title', 'Minutes');
    await api.post('/api/documents', form);
    const headers = stub.calls[1].options.headers;
    assert.equal(stub.calls[1].options.body, form);
    // Anything but the browser's own multipart boundary breaks the upload server-side.
    assert.equal(headers['Content-Type'], undefined);
  } finally {
    restore();
    stub.restore();
  }
});

test('a JSON body is serialised, and the error keeps the caller’s own data object', async () => {
  // The regression that mattered: the outbox stores `config.data` and replays it. If the client hands
  // over an already-serialised string, `{...body}` in the queue turns a payment into
  // `{0:"{",1:"\""…}` — stored, then refused, then discarded. The body has to survive as an object.
  const payload = { memberId: 'abc', amount: 1400, clientRequestId: 'r-1' };
  const stub = captureFetch(new Error('socket hang up'));
  try {
    await assert.rejects(
      () => api.post('/api/ledger/log', payload, { offlineQueue: true }),
      (err) => {
        assert.equal(err.code, 'ERR_NETWORK');
        assert.deepEqual(err.config.data, payload, 'the body must reach the queue as an object');
        assert.equal(err.config.offlineQueue, true);
        return true;
      }
    );
    // And it is serialised on the wire, which is the only place it should be.
    assert.equal(stub.calls[0].options.body, JSON.stringify(payload));
    assert.equal(stub.calls[0].options.headers['Content-Type'], 'application/json');
  } finally {
    stub.restore();
  }
});

test('an API refusal arrives with the status and the message the screens print', async () => {
  const stub = captureFetch(respond({ status: 409, body: '{"message":"Already registered"}' }));
  try {
    await assert.rejects(
      () => api.post('/api/members', { name: 'Jane' }),
      (err) => {
        assert.equal(err.response.status, 409);
        assert.equal(err.response.data.message, 'Already registered');
        assert.equal(apiMessage(err), 'Already registered');
        return true;
      }
    );
  } finally {
    stub.restore();
  }
});

test('a refused download stays a Blob so the real message can be read out of it', async () => {
  // utils/blobError unwraps `err.response.data` when it is a Blob of JSON — that is how a rate-limit
  // message reaches the screen instead of a generic fallback.
  const stub = captureFetch(
    respond({ status: 429, body: '{"message":"Too many requests."}', type: 'application/json' })
  );
  let rejected = null;
  try {
    await assert.rejects(
      () => api.get('/api/members/export', { responseType: 'blob' }),
      (err) => {
        rejected = err;
        return true;
      }
    );
  } finally {
    stub.restore();
  }

  // Read outside the validator: it has to answer synchronously, and reading a Blob does not.
  assert.ok(rejected.response.data instanceof Blob, 'a blob request must fail with a Blob');
  assert.match(rejected.response.data.type, /json/);
  const parsed = JSON.parse(await rejected.response.data.text());
  assert.match(parsed.message, /Too many requests/);
  // The screen's own path through it.
  const { blobErrorMessage } = await import('../src/utils/blobError.js');
  assert.match(await blobErrorMessage(rejected, 'Could not download'), /Too many requests/);
});

test('an unreachable server is named as a connection problem, not a refusal', async () => {
  const stub = captureFetch(new TypeError('Failed to fetch'));
  try {
    await assert.rejects(
      () => api.get('/api/members'),
      (err) => {
        assert.equal(err.code, 'ERR_NETWORK');
        assert.equal(err.response, undefined, 'no response happened, so there is none to report');
        assert.match(apiMessage(err), /No connection/);
        return true;
      }
    );
  } finally {
    stub.restore();
  }
});

test('a stalled request hits the ceiling instead of hanging on the button', async () => {
  // Per-request, so this is proved in milliseconds rather than in the 20 seconds a real member waits.
  // What it checks is that the abort is wired at all: without it the fetch promise never settles, and
  // "Saving…" stays on the screen for ever on the cell that dropped.
  const stub = captureFetch(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })
  );
  const started = Date.now();
  try {
    await assert.rejects(
      () => api.get('/api/members', { timeout: 60 }),
      (err) => {
        assert.equal(err.code, 'ECONNABORTED');
        assert.match(apiMessage(err), /took too long/);
        return true;
      }
    );
    const waited = Date.now() - started;
    assert.ok(waited >= 50, `it gave up after ${waited}ms, before the ceiling it was given`);
    assert.ok(waited < 5000, `it waited ${waited}ms — the ceiling is not wired up`);
  } finally {
    stub.restore();
  }
});

test('a queued body is an object, whether it was handed one or a string of JSON', () => {
  const { normaliseBody } = queue;

  const payload = { memberId: 'abc', amount: 1400 };
  assert.deepEqual(normaliseBody(payload), payload);
  // The shape that used to arrive from the client, now read back rather than spread into characters.
  assert.deepEqual(normaliseBody(JSON.stringify(payload)), payload);
  assert.deepEqual(normaliseBody(undefined), {});

  // Storing something the API could never accept only moves the loss somewhere quieter.
  assert.throws(() => normaliseBody('not json'), /JSON/);
  assert.throws(() => normaliseBody('[1,2,3]'), /JSON object/);
});
