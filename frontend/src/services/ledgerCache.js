// A tiny in-memory cache for the ledger, plus a prefetch. The point is round
// trips: opening the dashboard, the member list and one member's panel used to
// be three separate fetches, each a second or more on a slow link, each flashing
// a spinner. Nothing here holds data longer than a page view or two, and every
// write path calls invalidateLedger().
const TTL_MS = 30 * 1000;
const store = new Map(); // key -> { at, data }

function read(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return hit.data;
}

function write(key, data) {
  store.set(key, { at: Date.now(), data });
  return data;
}

const listKey = 'ledger';
const memberKey = (id) => `ledger:${id}`;

export function getCachedLedger() {
  return read(listKey);
}

// Returns the cached list untouched if it is fresh; otherwise fetches. Callers
// that want to repaint immediately use getCachedLedger() first and let this
// settle in the background.
export async function fetchLedger(api) {
  const hit = read(listKey);
  if (hit) return hit;
  const res = await api.get('/api/ledger');
  return write(listKey, res.data);
}

export function getCachedMember(id) {
  return read(memberKey(id));
}

export async function fetchMember(api, id) {
  const hit = read(memberKey(id));
  if (hit) return hit;
  const res = await api.get(`/api/ledger/members/${id}`);
  return write(memberKey(id), res.data);
}

// Fired on pointer-down so the panel has its data before the tap finishes.
export function prefetchMember(api, id) {
  if (!id || read(memberKey(id))) return;
  api
    .get(`/api/ledger/members/${id}`)
    .then((res) => write(memberKey(id), res.data))
    .catch(() => {});
}

// After anything that changes money, or the whole cache is a lie.
export function invalidateLedger() {
  store.clear();
}

// Fresh figures without a spinner: the list paints from whatever is cached and
// then quietly replaces it with what the server says now. The alternative — not
// refetching until the 30 s TTL runs out — leaves a treasurer looking at
// yesterday's totals after someone logged money on another phone.
//
// Skipped when the cached copy is only a moment old: flitting between the
// dashboard and the ledger would otherwise re-ask for a list that cannot have
// changed, on a link that is slow enough to notice.
const REVALIDATE_AFTER_MS = 5 * 1000;

export function revalidateLedger(api) {
  const hit = store.get(listKey);
  if (!hit || Date.now() - hit.at < REVALIDATE_AFTER_MS) return Promise.resolve(null);
  return api
    .get('/api/ledger')
    .then((res) => write(listKey, res.data))
    .catch(() => null);
}

export function seedMember(id, data) {
  write(memberKey(id), data);
}
