// The sidebar's sections.
//
// The grouping decides what an officer sees in the menu, and two mistakes in it are quiet
// ones: a destination that vanishes because its `group` was misspelled, and a heading with
// nothing under it because a role may not open any of its items. Both are checked here —
// the logic is a plain module with no JSX precisely so that `node --test` can reach it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { NAV_GROUP_ORDER, groupNavItems } from '../src/components/layout/navGroups.js';

// A small stand-in for NAV_ITEMS: same shape (to / label / group / roles), no icons.
const ITEMS = [
  { to: '/dashboard', label: 'Dashboard', group: 'Money', roles: ['admin', 'treasurer'] },
  { to: '/members', label: 'Members', group: 'Records' },
  { to: '/audit', label: 'Audit', group: 'Administration', roles: ['admin'] },
  { to: '/reminders', label: 'Reminders', group: 'Money', roles: ['treasurer'] },
];

test('a role sees only what it may open, in the declared section order', () => {
  const forTreasurer = groupNavItems(ITEMS, 'treasurer').map((g) => [
    g.title,
    g.items.map((i) => i.label),
  ]);
  assert.deepEqual(forTreasurer, [
    ['Money', ['Dashboard', 'Reminders']],
    // An item with no `roles` is for everybody.
    ['Records', ['Members']],
  ]);

  // The admin may not read the reminders, and sees no empty Money section left behind.
  assert.deepEqual(groupNavItems(ITEMS, 'admin').map((g) => g.title), [
    'Money',
    'Records',
    'Administration',
  ]);
});

test('a section nobody may open is left out rather than shown as a bare heading', () => {
  const groups = groupNavItems(ITEMS, 'secretary');
  assert.deepEqual(groups.map((g) => g.title), ['Records'], 'only what a secretary may open');
  assert.deepEqual(groupNavItems([], 'admin'), []);
});

test('a destination whose section is not listed still appears, and is never dropped', () => {
  // A new section added to navItems by name only: it shows up after the known ones,
  // rather than silently disappearing from the menu.
  const groups = groupNavItems([...ITEMS, { to: '/fines', label: 'Fines', group: 'Fines' }], 'admin');
  assert.deepEqual(groups.map((g) => g.title), [...NAV_GROUP_ORDER, 'Fines']);

  // And one with no group at all lands in More, still visible.
  const ungrouped = groupNavItems([{ to: '/x', label: 'X' }], 'admin');
  assert.deepEqual(ungrouped, [{ title: 'More', items: [{ to: '/x', label: 'X' }] }]);
});

test('every destination a role may open appears exactly once', () => {
  const shown = groupNavItems(ITEMS, 'admin').flatMap((g) => g.items.map((i) => i.to));
  const openable = ITEMS.filter((i) => !i.roles || i.roles.includes('admin')).map((i) => i.to);

  // Nothing is dropped on the way into a section, and nothing is listed twice.
  assert.deepEqual([...shown].sort(), [...openable].sort());
  assert.equal(new Set(shown).size, shown.length, 'no destination is listed twice');
});
