import api from './api';
import { fetchLedger } from './ledgerCache';

// Warming the next screen while the pointer is still on its link.
//
// An admin screen feels slow for two separate reasons, and both are paid for
// here on hover / pointer-down — typically 100–300 ms before the click lands:
//
//   1. the page's own JavaScript chunk has to arrive. Every admin page is
//      lazy-loaded so the public lookup stays lean, which means the first visit
//      to each screen costs a round trip for the chunk. Prefetching removes it
//      from the click path, so the page swaps instead of hanging.
//   2. its data has to come back from the API. `/api/ledger` is the expensive
//      one (every member, the week's figures), and the dashboard and the finance
//      page both render it — warming it here means MemberLedgerList paints from
//      the cache with no spinner at all.
//
// Nothing here is a router feature or a state library: it is a map of import()
// calls and one small slot for "the response the next screen is about to ask
// for". Every path degrades to the old behaviour if warming never happened.

const CHUNKS = {
  '/admin/dashboard': () => import('../pages/AdminDashboard.jsx'),
  '/admin/settings': () => import('../pages/AdminSettings.jsx'),
  '/admin/members': () => import('../pages/MembersList.jsx'),
  '/admin/finance': () => import('../pages/FinanceLedger.jsx'),
  '/admin/finance/setup': () => import('../pages/FinanceSetup.jsx'),
  '/admin/reports': () => import('../pages/Reports.jsx'),
  '/admin/minutes': () => import('../pages/Minutes.jsx'),
  '/admin/documents': () => import('../pages/Documents.jsx'),
  '/admin/reminders': () => import('../pages/Reminders.jsx'),
  '/admin/disciplinary': () => import('../pages/DisciplinaryFines.jsx'),
};

// The two detail screens reached by id rather than by a fixed path.
const MEMBER_RECORD = () => import('../pages/MemberDetail.jsx');
const MEMBER_LEDGER = () => import('../pages/FinanceMemberLedger.jsx');

const warmed = new Set();

// The chunk for a path, if it is one we can load ahead of time. Longest match
// first so '/admin/finance/setup' never warms '/admin/finance' instead.
function chunkFor(path) {
  if (CHUNKS[path]) return CHUNKS[path];
  if (path.startsWith('/admin/members/')) return MEMBER_RECORD;
  if (path.startsWith('/admin/finance/')) return MEMBER_LEDGER;
  return null;
}

export function warmRoute(to) {
  const path = String(to || '').split('?')[0].split('#')[0];
  const load = chunkFor(path);
  if (!load || warmed.has(path)) return;
  warmed.add(path);
  // A failed prefetch is not an error worth surfacing: the real navigation will
  // ask for the same chunk again and report properly if it is genuinely broken.
  load().catch(() => warmed.delete(path));

  // The ledger behind the two screens that log money, and the member list behind
  // the Members screen. The params match what each page asks for (see
  // MembersList's listParams) — a prefetch that doesn't line up is simply unused.
  if (path === '/admin/dashboard' || path === '/admin/finance') {
    fetchLedger(api).catch(() => {});
  }
  if (path === '/admin/members') {
    warmJson('/api/members', { page: 1, status: 'all' });
  }
}

// One member's record page: its chunk, plus the payload MemberDetail asks for on
// mount, so opening a name from the members list is a swap rather than a spinner.
export function warmMemberRecord(id) {
  if (!id) return;
  warmRoute(`/admin/members/${id}`);
  warmJson(`/api/members/${id}`);
}

// One slot for the response a list is about to ask for. Small on purpose: it is
// only ever populated by a hover or a press, so a stale entry lives for seconds.
const warm = new Map();

// Order-independent, and undefined params are dropped, so the key the page
// computes for a request and the key the prefetch stored always agree.
function keyOf(url, params) {
  const entries = Object.entries(params || {}).filter(
    ([, value]) => value !== undefined && value !== null
  );
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${url}?${JSON.stringify(entries)}`;
}

export function warmJson(url, params) {
  const key = keyOf(url, params);
  if (warm.has(key)) return;
  api
    .get(url, { params })
    .then((res) => warm.set(key, res.data))
    .catch(() => {});
}

export function takeWarmJson(url, params) {
  const key = keyOf(url, params);
  const hit = warm.get(key);
  if (hit === undefined) return null;
  warm.delete(key);
  return hit;
}

export function clearWarmJson() {
  warm.clear();
}
