// How the admin navigation is grouped, and the one place that decides it.
//
// A flat list of eleven rows is taller than a laptop screen and says nothing about what
// belongs with what: Members sat between Finance and Reports, Discipline sat under Audit,
// and somebody signing in for the first time had to read all eleven to find one thing. The
// groups are the ones the dashboard's own "Go to" panel already uses — Money, Records,
// Administration — so the two navigations describe the same work the same way.
//
// This is a plain module, with no JSX, so `node --test` can cover it (frontend/test/
// navGroups.test.js). The rules that matter are that a role only ever sees what it may
// open, and that no destination can silently disappear from the menu.
//
// The dashboard is the way home, not one of the money screens, so it sits above the sections in a
// group of its own (HOME_GROUP), which the sidebar draws without a heading: a title over a single
// row says nothing.
export const HOME_GROUP = 'Home';
export const NAV_GROUP_ORDER = [HOME_GROUP, 'Money', 'Records', 'Administration'];

// A destination that names no group is not dropped — it lands in "More", after the groups
// above. Same for a group this file has not been told about: it appears in the order it
// first occurs, so a new section is a `group:` in navItems rather than an edit here plus a
// hunt for why the link is missing.
const FALLBACK_GROUP = 'More';

export function groupNavItems(items = [], role = '') {
  const visible = items.filter((item) => !item.roles || item.roles.includes(role));

  const titles = [...NAV_GROUP_ORDER];
  for (const item of visible) {
    const title = item.group || FALLBACK_GROUP;
    if (!titles.includes(title)) titles.push(title);
  }

  return titles
    .map((title) => ({
      title,
      items: visible.filter((item) => (item.group || FALLBACK_GROUP) === title),
    }))
    // A heading with nothing under it is worse than no heading: that is what a role with a
    // narrow set of permissions would otherwise see.
    .filter((group) => group.items.length > 0);
}

// Which destination the page on screen belongs to: the one whose path is the longest match for it.
//
// A link matches by prefix, so a plain NavLink lit both "Finance" and "Expenses" on the spending
// screen (it lives at /admin/finance/expenses). The most specific destination wins instead, so
// Expenses owns its own screen while /admin/finance/setup and a member's ledger (/admin/finance/:id)
// still belong to Finance. Only the destinations passed in are considered, so a role that cannot open
// Expenses is shown Finance there. Returns the `to` of the destination, or null when the page is none
// of them (My account).
export function activeNavTo(items = [], pathname = '') {
  let best = null;
  for (const item of items) {
    if (pathname === item.to || pathname.startsWith(item.to + '/')) {
      if (!best || item.to.length > best.length) best = item.to;
    }
  }
  return best;
}
