// The statement periods, as data and as a query string.
//
// This lives in utils/ rather than inside the picker component for the reason everything else in
// here does: it is pure, so `npm test` can cover it without a DOM or a browser. The list of periods
// and the way one becomes a query are the two things the office's page and the members' page must
// agree about, and they are the two things a component cannot be tested for.
//
// The periods themselves are resolved on the **server** (backend/src/utils/statementPeriod), in East
// African time, against the same calendar the week engine uses. This module only passes the name
// through: resolving "this quarter" in the browser would be a second implementation of that
// calendar, and in January the two would disagree about which quarter "last quarter" is.
export const STATEMENT_PERIODS = [
  { value: 'whole', label: 'Everything (to date)' },
  { value: 'this-year', label: 'This year' },
  { value: 'last-year', label: 'Last year' },
  { value: 'this-quarter', label: 'This quarter' },
  { value: 'last-quarter', label: 'Last quarter' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'custom', label: 'Choose dates…' },
];

// The query fragment to append to a statement URL.
//
// `''` for the whole book, so a statement link is byte for byte what it was before periods existed —
// and the fragment always starts with `&`, because it is appended to a URL that already has
// `?nationalId=…` on it.
export function periodQuery(preset, from, to) {
  if (!preset || preset === 'whole') return '';
  if (preset === 'custom') {
    // No start date yet means nothing was really chosen, so this stays the whole book rather than
    // asking the API for a period it would refuse with a 400.
    if (!from) return '';
    const parts = [`from=${encodeURIComponent(from)}`];
    if (to) parts.push(`to=${encodeURIComponent(to)}`);
    return `&${parts.join('&')}`;
  }
  return `&range=${encodeURIComponent(preset)}`;
}

// What to call the chosen period, for a filename and for a screen reader.
export function periodLabel(preset) {
  return STATEMENT_PERIODS.find((option) => option.value === preset)?.label || '';
}
