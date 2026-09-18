// The week engine, pinned down.
//
// Every balance in the system is a function of these: a wrong week number is a
// wrong arrears figure for every member at once, and it would look like a data
// problem rather than a date-arithmetic one. The boundary cases below are the ones
// that actually bite — Friday morning (when a week rolls), Thursday night (when it
// closes), and a payment dated before the cycle opened.
//
// No database: these are pure functions over a settings document.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WEEK_MS,
  DEFAULT_WEEKLY_AMOUNT,
  DEFAULT_CHAI_AMOUNT,
  DEFAULT_CYCLE_START_WEEK,
  fridayOf,
  toEatDateString,
  parseEatDate,
  resolveConfig,
  weekNumberForDate,
  cycleWeekNumber,
  weekRange,
  currentWeekNumber,
  weeksElapsed,
  cycleHistory,
} = require('../src/utils/weekCycle');

// 2026-01-02 is a Friday — the anchor the live system was pinned to.
const settings = {
  cycleStartWeek: 92,
  weeklyAmount: 1400,
  chaiAmount: 100,
  weekAnchorDate: parseEatDate('2026-01-02'),
};
const config = resolveConfig(settings);

const at = (date) => parseEatDate(date);

test('the anchor is a Friday midnight in EAT', () => {
  assert.equal(fridayOf(at('2026-01-02')).getTime(), at('2026-01-02').getTime());
  assert.equal(toEatDateString(config.anchorDate), '2026-01-02');
});

test('a week runs Friday to Thursday and rolls on the Friday', () => {
  // The Friday itself is the first day of its own week.
  assert.equal(weekNumberForDate(at('2026-01-09'), config), 93);
  // The Thursday before it is the last day of the previous week — the rule the
  // collection night depends on (§7.4).
  assert.equal(weekNumberForDate(at('2026-01-08'), config), 92);
  assert.equal(weekNumberForDate(at('2026-01-01'), config), 91);
  assert.equal(weekNumberForDate(at('2025-12-26'), config), 91);
});

test('a week number is the start week plus whole weeks since the anchor', () => {
  assert.equal(weekNumberForDate(config.anchorDate, config), 92);
  assert.equal(weekNumberForDate(at('2026-02-27'), config), 100); // 8 weeks on
  assert.equal(weekNumberForDate(new Date(config.anchorMs + 4 * WEEK_MS), config), 96);
});

test('fridayOf lands on the Friday on or before any day', () => {
  // Saturday 2026-01-03 → Friday 2026-01-02
  assert.equal(toEatDateString(fridayOf(at('2026-01-03'))), '2026-01-02');
  // Wednesday 2026-01-07 → Friday 2026-01-02
  assert.equal(toEatDateString(fridayOf(at('2026-01-07'))), '2026-01-02');
  // Exactly Friday stays put
  assert.equal(toEatDateString(fridayOf(at('2026-01-09'))), '2026-01-09');
  // Thursday 23:30 EAT is still that same week's Thursday
  assert.equal(toEatDateString(fridayOf(new Date(at('2026-01-08').getTime() + 23.5 * 3600 * 1000))), '2026-01-02');
});

test('a week range is seven days, Friday through Thursday', () => {
  const range = weekRange(92, config);
  assert.equal(range.startDate.getTime(), config.anchorMs);
  assert.equal(range.endDate.getTime() - range.startDate.getTime(), WEEK_MS - 1);
  assert.equal(toEatDateString(range.endDate), '2026-01-08'); // the Thursday
});

test('nothing is credited before the cycle opens', () => {
  // A payment dated inside the history is credited to the opening week rather than
  // to a week the ledger has no row for (§7.3).
  assert.equal(cycleWeekNumber(at('2025-06-06'), config), 92);
  assert.equal(cycleWeekNumber(at('2026-01-09'), config), 93);
  assert.equal(currentWeekNumber(config, at('2020-01-01')), 92);
});

test('weeks elapsed counts the week running today as one', () => {
  assert.equal(weeksElapsed(config, at('2026-01-02')), 1);
  assert.equal(weeksElapsed(config, at('2026-01-08')), 1);
  assert.equal(weeksElapsed(config, at('2026-01-09')), 2);
  assert.equal(weeksElapsed(config, at('2026-01-16')), 3);
});

test('the history runs back to week 1 without an expectation', () => {
  const history = cycleHistory(config);
  assert.equal(history.length, 91); // weeks 1 … 91
  assert.equal(history[0].weekNumber, 1);
  assert.equal(history[history.length - 1].weekNumber, 91);
  assert.ok(history.every((week) => week.isHistory === true));
  // Contiguous: each week starts exactly one week after the one before it.
  for (let i = 1; i < history.length; i += 1) {
    assert.equal(history[i].startDate.getTime() - history[i - 1].startDate.getTime(), WEEK_MS);
  }
});

test('EAT dates survive a round trip through the API', () => {
  // The bug this prevents: read an instant's first ten characters in a UTC browser
  // and the anchor moves a day, which renumbers every week.
  assert.equal(toEatDateString(parseEatDate('2026-01-02')), '2026-01-02');
  assert.equal(toEatDateString(parseEatDate('2026-06-30')), '2026-06-30');
  assert.equal(toEatDateString(parseEatDate(new Date('2026-01-02T21:30:00.000Z'))), '2026-01-03');
});

test('config falls back to the constitution\'s amounts and refuses to guess the anchor', () => {
  const minimal = resolveConfig({ weekAnchorDate: parseEatDate('2026-01-02') });
  assert.equal(minimal.cycleStartWeek, DEFAULT_CYCLE_START_WEEK);
  assert.equal(minimal.weeklyAmount, DEFAULT_WEEKLY_AMOUNT);
  assert.equal(minimal.chaiAmount, DEFAULT_CHAI_AMOUNT);
  assert.throws(() => resolveConfig({}), /anchor is not set/);
});
