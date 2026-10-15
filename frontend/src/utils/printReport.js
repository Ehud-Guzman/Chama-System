// The meeting report's menu: which sections there are, who may print which, and the request a
// ticked set of them turns into.
//
// Kept apart from the panel so the one decision with consequences — which sections go to the server
// — can be tested without a browser. The server repeats the role check (a secretary asking for the
// spending section is refused whatever this screen offers); this is the screen not offering it.

// In the order the page prints them, with the keys the API reads (backend/src/utils/meetingReport).
export const PRINT_SECTIONS = [
  {
    key: 'position',
    label: 'Where the money stands',
    hint: 'Money in, spent and held, and what each fund holds',
  },
  {
    key: 'week',
    label: "This week's collection",
    hint: 'What the week asks for, what has come in, and how many are still to pay',
  },
  {
    key: 'debts',
    label: 'Members below the line (debts)',
    hint: "Who holds less than this week's money line, and by how much",
  },
  {
    key: 'extra',
    label: 'Members above the line (extra)',
    hint: 'Who holds more than the line, and by how much',
  },
  {
    key: 'fines',
    label: 'Fines',
    hint: 'Issued, paid off and still owed, by type and by member',
  },
  {
    key: 'expenses',
    label: 'Expenses',
    hint: 'What was spent, by fund, with vouchers and notes',
    // Itemised spending is for the people who keep the books.
    roles: ['super_admin', 'admin', 'treasurer'],
  },
];

export const EXPENSE_PERIODS = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'Everything on record' },
];

// The sections this role is offered.
export function sectionsFor(role) {
  return PRINT_SECTIONS.filter((section) => !section.roles || section.roles.includes(role));
}

// The query for a ticked set, or null when nothing printable is ticked. Anything not on this role's
// menu is dropped, whatever the set holds, and the sections go in print order so the same ticks
// always make the same request.
export function printQuery(selected, period, role) {
  const ticked = new Set(selected);
  const sections = sectionsFor(role)
    .map((section) => section.key)
    .filter((key) => ticked.has(key));
  if (sections.length === 0) return null;

  const params = { sections: sections.join(',') };
  // The period belongs to the spending section: sending it with nothing to apply it to would only
  // make the request look like it asked for something it did not.
  if (sections.includes('expenses')) {
    params.expenses = EXPENSE_PERIODS.some((p) => p.value === period) ? period : 'week';
  }
  return params;
}
