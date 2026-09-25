// The minutes list grouped into months, under node's own test runner.
//
// Two mistakes here would be quiet ones, and both are covered below: a month key that
// sorts as a word ('2026-9' is greater than '2026-12' as text, so September would be
// handed the newest month of the year) and a month label built from the wrong index
// ('January' is 0, not 1). So is the rule that nothing in the list is lost on the way
// into a group.
//
//   npm test        (in frontend/)
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UNDATED_KEY,
  UNDATED_LABEL,
  monthKeyOf,
  monthLabelOf,
  groupMinutesByMonth,
} from '../src/utils/minuteGroups.js';

// Local dates on purpose. The month a minute falls in is the reader's own calendar
// month — the same one printed beside the row — so a test written at UTC midnight
// would be asking a different question than the one the screen answers.
const on = (year, month, day) => new Date(year, month - 1, day, 12, 0, 0);

test('months run newest first, across years and in calendar order', () => {
  const minutes = [
    { title: 'May', date: on(2026, 5, 21) },
    { title: 'December', date: on(2026, 12, 5) },
    { title: 'Last November', date: on(2025, 11, 30) },
    { title: 'April', date: on(2026, 4, 2) },
    { title: 'August', date: on(2026, 8, 11) },
  ];

  assert.deepEqual(
    groupMinutesByMonth(minutes).map((group) => group.key),
    ['2026-12', '2026-08', '2026-05', '2026-04', '2025-11']
  );
});

test('a month key is zero-padded, which is what makes newest-first work', () => {
  assert.equal(monthKeyOf(on(2026, 9, 1)), '2026-09');
  assert.equal(monthKeyOf(on(2026, 1, 9)), '2026-01');
  assert.equal(monthKeyOf(on(2026, 12, 31)), '2026-12');

  // Unpadded, September would sort above December ('2026-9' > '2026-12') and the
  // office's newest meeting would be buried under the oldest month of the year.
  const minutes = [
    { title: 'September', date: on(2026, 9, 2) },
    { title: 'December', date: on(2026, 12, 2) },
  ];
  assert.deepEqual(
    groupMinutesByMonth(minutes).map((group) => group.key),
    ['2026-12', '2026-09']
  );
});

test('a month prints its own name, with the year', () => {
  // January and December are where an off-by-one is visible.
  assert.equal(monthLabelOf('2026-01'), 'January 2026');
  assert.equal(monthLabelOf('2026-02'), 'February 2026');
  assert.equal(monthLabelOf('2026-05'), 'May 2026');
  assert.equal(monthLabelOf('2025-12'), 'December 2025');
});

test('every minute arrives in a group, in the order it was given', () => {
  const minutes = [
    { title: 'May 21', date: on(2026, 5, 21) },
    { title: 'No date at all', date: null },
    { title: 'May 7', date: on(2026, 5, 7) },
    { title: 'Wording', date: 'not a date' },
  ];

  const groups = groupMinutesByMonth(minutes);
  assert.equal(
    groups.reduce((count, group) => count + group.minutes.length, 0),
    minutes.length,
    'nothing is dropped on the way into a group'
  );

  // Newest first inside the month, the order the API sent.
  const may = groups.find((group) => group.key === '2026-05');
  assert.deepEqual(may.minutes.map((minute) => minute.title), ['May 21', 'May 7']);

  // A date nothing can be read from is said out loud, at the end of the list, rather
  // than making the minute vanish from the office's screen.
  const last = groups[groups.length - 1];
  assert.equal(last.key, UNDATED_KEY);
  assert.equal(last.label, UNDATED_LABEL);
  assert.deepEqual(last.minutes.map((minute) => minute.title), ['No date at all', 'Wording']);
});

test('two meetings in one month meet in one group', () => {
  const groups = groupMinutesByMonth([
    { title: 'March 3', date: on(2026, 3, 3) },
    { title: 'January 6', date: on(2026, 1, 6) },
    { title: 'March 24', date: on(2026, 3, 24) },
  ]);

  assert.deepEqual(
    groups.map((group) => group.key),
    ['2026-03', '2026-01']
  );
  assert.deepEqual(groups[0].minutes.map((minute) => minute.title), ['March 3', 'March 24']);
});

test('an empty or missing list is no groups at all', () => {
  assert.deepEqual(groupMinutesByMonth([]), []);
  assert.deepEqual(groupMinutesByMonth(null), []);
  assert.deepEqual(groupMinutesByMonth(undefined), []);
});

test('a label is never built out of a month that does not exist', () => {
  assert.equal(monthLabelOf('2026-13'), UNDATED_LABEL);
  assert.equal(monthLabelOf('2026-00'), UNDATED_LABEL);
  assert.equal(monthLabelOf(''), UNDATED_LABEL);
  assert.equal(monthLabelOf(null), UNDATED_LABEL);

  assert.equal(monthKeyOf(''), null);
  assert.equal(monthKeyOf(null), null);
  assert.equal(monthKeyOf(undefined), null);
  assert.equal(monthKeyOf('nonsense'), null);
});
