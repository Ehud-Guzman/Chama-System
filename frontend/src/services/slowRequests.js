// Whether the server is taking long enough to answer that the person waiting should be told why.
//
// The free host sleeps when nobody has used it for a while, and the first request after that is answered only
// once it has started, which takes about half a minute. api.js already asks a sleeping host a second time
// instead of failing; this is the other half, so that the person staring at a loading screen is told it is
// waking up and not left to think the site is broken and close it.
//
// A request counts as slow once it has been waiting SLOW_AFTER_MS, and the notice goes away when the last slow
// one settles, so a normal load (well under a second) never shows it. Plain functions and a subscribe, no React,
// so the rule is tested without a browser and api.js can use it without importing one.

export const SLOW_AFTER_MS = 6000;

export function createSlowTracker(slowAfterMs = SLOW_AFTER_MS) {
  const listeners = new Set();
  const pending = new Map(); // id -> timer
  const slow = new Set(); // ids that have waited long enough
  let nextId = 1;
  let snapshot = false;

  function publish() {
    const next = slow.size > 0;
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  // Call when a request starts; call the returned function when it settles, however it settles.
  function begin() {
    const id = nextId++;
    const timer = setTimeout(() => {
      slow.add(id);
      publish();
    }, slowAfterMs);
    pending.set(id, timer);
    return function end() {
      clearTimeout(pending.get(id));
      pending.delete(id);
      slow.delete(id);
      publish();
    };
  }

  return {
    begin,
    isSlow: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const slowRequests = createSlowTracker();
