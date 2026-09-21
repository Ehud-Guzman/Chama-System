// The outbox: writes made while the phone had no signal, kept until it does.
//
// The treasurer collects on a Thursday evening, in a hall, on a phone, on a cell that has given
// up. Until now every one of those attempts ended in "No connection. Check your data or Wi-Fi and
// try again." — and the figure he had just read out of a member's hand went nowhere. This keeps
// it instead, and sends it when the signal comes back.
//
// It works because the API was already built for it: `Contribution.clientRequestId` is a unique
// sparse index, so a queued write replayed twice resolves to the *same* payment instead of
// creating a second one. That is the whole reason a queue is safe here and would not be in most
// apps, and it is why only requests carrying a client request id are allowed into the outbox.
//
// Two rules the code below follows deliberately:
//
//   * **Nothing is queued silently.** A request only goes in the outbox when the caller marked it
//     `offlineQueue: true`. A surprise "the button said it failed but it actually saved" is worse
//     than an honest failure, and it is how money gets credited twice.
//   * **A refusal is not retried.** A 4xx means the API understood the request and said no.
//     Retrying that forever fills the queue with something that can never succeed and hides the
//     real entry behind it.

const DB_NAME = 'chama-offline';
const DB_VERSION = 1;
const STORE = 'outbox';

// -----------------------------------------------------------------------------
// What to do with a send that failed (pure, and tested)
// -----------------------------------------------------------------------------

// `keep` — the network or the server was the problem. Try again later, in order.
// `drop` — the request itself is the problem, or it already landed. Discard it and say so.
function classifyFailure(err) {
  const status = err?.response?.status;
  if (status === undefined) return 'keep'; // no response at all: offline, DNS, timeout
  if (status === 408 || status === 429) return 'keep'; // timed out or rate-limited: retryable
  if (status >= 500) return 'keep'; // the server's problem, not the request's
  return 'drop'; // 400/401/403/404/409/422: retrying changes nothing
}

// Whether a refusal was really a duplicate. A conflict means an earlier attempt *did* land — so
// the honest thing to tell the office is "that one went through", not "that one was refused".
function looksLikeDuplicate(err) {
  const status = err?.response?.status;
  const message = String(err?.response?.data?.message || '').toLowerCase();
  return status === 409 || /already|duplicate|exists/.test(message);
}

// -----------------------------------------------------------------------------
// IndexedDB plumbing
// -----------------------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot store items offline'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the offline store'));
  });
}

function withStore(mode, work) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let result = null;
        // The transaction's completion is what "it is stored" means. Resolving when the request
        // succeeds would report success before the write was durable.
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error || new Error('The offline store refused the write'));
        };
        result = work(tx.objectStore(STORE));
      })
  );
}

// -----------------------------------------------------------------------------
// The queue
// -----------------------------------------------------------------------------

const listeners = new Set();

function announce(size) {
  listeners.forEach((listener) => listener(size));
}

// The badge in the header subscribes to this, so the count it shows is always the count in the
// store rather than a number kept in two places.
export function subscribe(listener) {
  listeners.add(listener);
  count().then(announce).catch(() => announce(0));
  return () => listeners.delete(listener);
}

// A body that arrives as a JSON string is read back into an object first.
//
// The HTTP client used to hand this function axios's already-serialised body, and `{...body}` on a
// string produces `{0:"{",1:'"'…}` — so a queued payment was stored as something the API could never
// accept, and the next flush discarded it as a refusal. The client now passes the object itself
// (see services/api.js), and this reads a string back anyway: an outbox whose whole job is not
// losing money should not depend on its caller getting that right. A string that will not parse is
// refused outright rather than stored, because keeping something unsendable only moves the loss
// somewhere quieter.
function normaliseBody(body) {
  if (typeof body !== 'string') return { ...(body || {}) };
  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('A queued request body must be a JSON object');
  }
  return { ...parsed };
}

// Queues one request. The idempotency key is generated here if the caller did not supply one, so
// a write queued twice — or replayed after a reload — is still one write.
export async function queueRequest({ url, method = 'post', body, label = '' }) {
  const payload = normaliseBody(body);
  if (!payload.clientRequestId) {
    payload.clientRequestId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  const entry = {
    url,
    method,
    body: payload,
    label,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    clientRequestId: payload.clientRequestId,
  };

  await withStore('readwrite', (store) => {
    store.add(entry);
    return null;
  });
  announce(await count());
  return entry;
}

export async function listQueued() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => {
        db.close();
        // Oldest first: the order the treasurer typed them in is the order they belong in the
        // books, and it is the order the API will see.
        resolve((request.result || []).sort((a, b) => a.id - b.id));
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    // Storage unavailable (private mode, a full quota): the honest answer is "nothing is queued",
    // because nothing can be.
    return [];
  }
}

export async function count() {
  return (await listQueued()).length;
}

async function remove(id) {
  return withStore('readwrite', (store) => {
    store.delete(id);
    return null;
  });
}

async function bumpAttempts(entry, error) {
  return withStore('readwrite', (store) => {
    store.put({ ...entry, attempts: (entry.attempts || 0) + 1, lastError: error });
    return null;
  });
}

// Sends everything queued, oldest first, and stops at the first thing that cannot be sent.
//
// Returns what happened per entry so the caller can tell the user something true: `sent`,
// `duplicates` (an earlier attempt had already landed), `rejected` (the API refused it, and it has
// been discarded, with the reason) and `remaining` (what is still waiting).
export async function flush(api) {
  const queued = await listQueued();
  const result = { sent: 0, duplicates: 0, rejected: [], remaining: 0, stopped: null };

  for (const entry of queued) {
    try {
      await api.request({ url: entry.url, method: entry.method, data: entry.body });
      await remove(entry.id);
      result.sent += 1;
    } catch (err) {
      if (classifyFailure(err) === 'keep') {
        // Stop, rather than skipping ahead: if his first log cannot be sent, his second must not
        // go without it, or his statement reads as though the later one came first.
        await bumpAttempts(entry, err?.message || 'unknown');
        result.stopped = { label: entry.label || entry.url, reason: err?.message || 'no connection' };
        break;
      }
      await remove(entry.id);
      if (looksLikeDuplicate(err)) {
        result.duplicates += 1;
      } else {
        result.rejected.push({
          label: entry.label || entry.url,
          message: err?.response?.data?.message || 'The server refused it',
        });
      }
    }
  }

  result.remaining = await count();
  announce(result.remaining);
  return result;
}

export const __test = { classifyFailure, looksLikeDuplicate, normaliseBody };
