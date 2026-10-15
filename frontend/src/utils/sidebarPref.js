// Whether the desktop sidebar is folded down to its icons, remembered between visits.
//
// A convenience, never a record: it lives in the browser only, so a different machine starts with the
// menu open, and every read and write is allowed to fail. Storage can be missing or can throw (a
// private window, blocked site data), and the menu must still work — it simply forgets.
const KEY = 'chama.sidebarCollapsed';

// The browser's storage, or null where there is none to be had. Reaching for `localStorage` at all
// can throw, which is why even getting hold of it is inside the try.
export function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readCollapsed(storage = browserStorage()) {
  try {
    return storage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCollapsed(collapsed, storage = browserStorage()) {
  try {
    storage?.setItem(KEY, collapsed ? '1' : '0');
  } catch {
    // Not remembered; the menu still folds.
  }
}
