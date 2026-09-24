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
export const NAV_GROUP_ORDER = ['Money', 'Records', 'Administration'];

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
