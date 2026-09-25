// The minutes list, arranged by month.
//
// An office that has kept minutes for a few years does not have a list any more, it
// has a wall of dates: the meeting somebody is looking for is one they remember by
// month — "the May meeting" — not by its place in a scroll. So the list is months,
// newest first, each month holding its own meetings and closed until it is asked for.
//
// Kept as a plain module with no React in it, so `node --test` can cover the two
// mistakes that would be quiet ones:
//
//   * a month key that sorts as a word. '2026-9' is greater than '2026-12' as text,
//     so an unpadded key hands the year's newest month to September. The keys are
//     zero-padded, which is what lets newest-first be a string comparison rather
//     than a Date built per pair;
//   * a month that prints the wrong name — `Number(month) - 1` is the off-by-one
//     that ships as "January" over a February meeting.
//
// The month is the reader's own calendar month — the same one the date beside the
// row is printed in. A minute's date is stored as UTC midnight and read on a Kenyan
// phone, where that instant is the same day at 03:00, so the heading and the rows
// under it always agree.

// A fixed list rather than a locale call: the same heading on every device, in any
// language, the way the reports screen builds its own month labels.
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// A minute whose date cannot be read (an imported record, a field typed over) gets a
// group of its own at the end rather than being dropped. A list that silently loses a
// record is worse than one that admits the record has no date.
export const UNDATED_KEY = 'undated';
export const UNDATED_LABEL = 'No date';

function pad(number) {
  return String(number).padStart(2, '0');
}

// 'YYYY-MM' for any value a date field can hold, or null when nothing about it can be
// put on a calendar.
export function monthKeyOf(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

// The heading for a month key: "May 2026". The year is spelled out because the list
// runs back through more than one of them and "May" alone would not say which.
export function monthLabelOf(key) {
  const [year, month] = String(key ?? '').split('-');
  const name = MONTH_NAMES[Number(month) - 1];
  if (!year || !name) return UNDATED_LABEL;
  return `${name} ${year}`;
}

// The minutes as month groups, newest first, each group keeping the order it was
// given — the API sends newest first, so an open month reads newest first too.
export function groupMinutesByMonth(minutes) {
  const list = Array.isArray(minutes) ? minutes : [];
  const byMonth = new Map();
  const undated = [];

  for (const minute of list) {
    const key = monthKeyOf(minute?.date);
    if (!key) {
      undated.push(minute);
      continue;
    }
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(minute);
  }

  const groups = [...byMonth.entries()]
    // 'YYYY-MM' sorts the same as it reads, so no Date objects are built to order
    // these — and the order is what puts the newest meeting at the top of the list.
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, items]) => ({ key, label: monthLabelOf(key), minutes: items }));

  if (undated.length) {
    groups.push({ key: UNDATED_KEY, label: UNDATED_LABEL, minutes: undated });
  }

  return groups;
}
