// The weekly contribution by week: a rise applies from its own week onward and never reaches back.
//
// The group raises the weekly amount from a given week. What the engine must hold to is that every week
// before the rise keeps what it asked (so a member who paid in full is still paid in full), the group's line
// rises by the new amount from the rise on, and with no rise at all nothing differs from a single number.
const test = require('node:test');
const assert = require('node:assert/strict');

const { normaliseWeeklyChanges, weeklyAmountForWeek, sumWeeklyAmounts } = require('../src/utils/weeklyAmounts');
const { resolveConfig, parseEatDate, weekRange } = require('../src/utils/weekCycle');
const { moneyLimitForWeek } = require('../src/utils/reminderLimit');
const { computeMemberLedger } = require('../src/utils/memberLedger');
const { buildWeeklySchedule } = require('../src/utils/weeklySchedule');

// The live books: week 98 is the opening week (Friday 23 Oct 2026), 123,600 there, 1,500 a week, tea 100.
const BOOKS = {
  cycleStartWeek: 98,
  weekAnchorDate: parseEatDate('2026-10-23'),
  weeklyAmount: 1500,
  chaiAmount: 100,
  reminderMoneyLimit: 123600,
  reminderMoneyLimitWeek: 98,
};
const withRise = (...changes) => ({ ...BOOKS, weeklyAmountChanges: changes });

test('a list of rises is cleaned: whole weeks, positive amounts, ascending, the last of a week winning', () => {
  assert.deepEqual(
    normaliseWeeklyChanges([
      { fromWeek: 105, amount: 3000 },
      { fromWeek: 103, amount: 2000 },
      { fromWeek: 103, amount: 2200 },
      { fromWeek: 0, amount: 1 },
      { fromWeek: 104.5, amount: 1 },
      { fromWeek: 106, amount: -5 },
      { fromWeek: 107 },
      null,
    ]),
    [
      { fromWeek: 103, amount: 2200 },
      { fromWeek: 105, amount: 3000 },
    ]
  );
  assert.deepEqual(normaliseWeeklyChanges(undefined), []);
  assert.deepEqual(normaliseWeeklyChanges('nonsense'), []);
});

test('each week asks what was in force from the week it started', () => {
  const config = resolveConfig(withRise({ fromWeek: 103, amount: 2000 }, { fromWeek: 106, amount: 2500 }));
  assert.equal(weeklyAmountForWeek(config, 98), 1500, 'the opening week');
  assert.equal(weeklyAmountForWeek(config, 102), 1500, 'the last week before the rise');
  assert.equal(weeklyAmountForWeek(config, 103), 2000, 'the week the rise starts');
  assert.equal(weeklyAmountForWeek(config, 105), 2000);
  assert.equal(weeklyAmountForWeek(config, 106), 2500, 'a second rise');
  assert.equal(weeklyAmountForWeek(config, 200), 2500);
});

test('summing the weeks adds each its own amount, and an empty range is nothing', () => {
  const config = resolveConfig(withRise({ fromWeek: 103, amount: 2000 }));
  assert.equal(sumWeeklyAmounts(config, 99, 102), 4 * 1500);
  assert.equal(sumWeeklyAmounts(config, 99, 104), 4 * 1500 + 2 * 2000);
  assert.equal(sumWeeklyAmounts(config, 103, 103), 2000);
  assert.equal(sumWeeklyAmounts(config, 110, 109), 0);
});

test('with no rise every week asks the same, exactly as a single number did', () => {
  const config = resolveConfig(BOOKS);
  for (const week of [92, 98, 99, 150]) assert.equal(weeklyAmountForWeek(config, week), 1500);
  assert.equal(sumWeeklyAmounts(config, 99, 108), 10 * 1500);
  // A plain object, the way the older tests build a cycle by hand, works the same.
  assert.equal(weeklyAmountForWeek({ cycleStartWeek: 92, weeklyAmount: 1400 }, 120), 1400);
  assert.equal(sumWeeklyAmounts({ cycleStartWeek: 92, weeklyAmount: 1400 }, 93, 95), 4200);
});

test('config.weeklyAmount is what is asked now, and weeklyBase what the cycle opened with', () => {
  const config = resolveConfig(withRise({ fromWeek: 1, amount: 1800 }));
  // A rise "from week 1" is in force whenever "now" is, so the amount now is the raised one.
  assert.equal(config.weeklyBase, 1500);
  assert.equal(config.weeklyAmount, 1800);
  assert.deepEqual(config.weeklyChanges, [{ fromWeek: 1, amount: 1800 }]);
  // A rise far in the future leaves "now" at the opening amount.
  assert.equal(resolveConfig(withRise({ fromWeek: 9999, amount: 5000 })).weeklyAmount, 1500);
});

test('the line rises by each week’s own amount: a rise lifts it from its week, not before', () => {
  const settings = withRise({ fromWeek: 103, amount: 2000 });
  const config = resolveConfig(settings);
  const line = (w) => moneyLimitForWeek(settings, config, w);
  assert.equal(line(98), 123600, 'the figure itself in the week it was measured');
  assert.equal(line(99), 125100, 'unchanged by a rise that has not started');
  assert.equal(line(102), 129600, 'the last week before the rise');
  assert.equal(line(103), 131600, 'the rise’s own week adds the NEW amount: 129,600 + 2,000');
  assert.equal(line(104), 133600);
  assert.equal(line(105), 135600);
});

test('with no rise the line is what it always was', () => {
  const config = resolveConfig(BOOKS);
  assert.equal(moneyLimitForWeek(BOOKS, config, 99), 125100);
  assert.equal(moneyLimitForWeek(BOOKS, config, 108), 123600 + 10 * 1500);
});

test('a week a member paid in full stays paid in full after a rise, and the rise’s week asks the new amount', () => {
  // Weeks 99-101 paid at 1,500; the weekly amount rises to 2,000 from week 102. Read on Friday 4 Dec, the first
  // day of week 104, when weeks 99-103 have closed.
  const settings = withRise({ fromWeek: 102, amount: 2000 });
  const config = resolveConfig(settings);
  const payIn = (week, amount) => ({
    _id: `w${week}`,
    bucket: 'weekly',
    isGroupFund: false,
    amount,
    date: new Date(weekRange(week, config).startDate.getTime() + 86400000),
  });
  const ledger = computeMemberLedger({
    member: { openingBalance: 130000 },
    contributions: [payIn(99, 1500), payIn(100, 1500), payIn(101, 1500), payIn(102, 2000), payIn(103, 1500)],
    config,
    now: parseEatDate('2026-12-04'), // a Friday: week 104 has begun (week 98 began 23 Oct)
  });

  const week = (n) => ledger.weeks.find((w) => w.weekNumber === n);
  for (const n of [99, 100, 101]) {
    assert.equal(week(n).weeklyAmount, 1500, `week ${n} still asks 1,500`);
    assert.equal(week(n).status, 'paid', `week ${n} paid 1,500 and stays paid`);
    assert.equal(week(n).shortfall, 0);
  }
  assert.equal(week(102).weeklyAmount, 2000);
  assert.equal(week(102).status, 'paid');
  assert.equal(week(103).weeklyAmount, 2000);
  assert.equal(week(103).status, 'partial', '1,500 against the new 2,000');
  assert.equal(week(103).shortfall, 500);

  assert.equal(ledger.weeksScored, 5, 'weeks 99-103 have closed');
  assert.equal(ledger.required, 3 * 1500 + 2 * 2000, 'each closed week asked its own amount');
  assert.equal(ledger.arrears, 500, 'only the week that really fell short');
  assert.equal(ledger.weeksBehind, 1);
  assert.equal(ledger.weeklyAmount, 2000, 'what is asked now');
  assert.equal(ledger.weeklyChanged, true, 'the closed weeks did not all ask the same');
});

test('without a rise nothing about the ledger changes: the same amount every week, weeklyChanged false', () => {
  const config = resolveConfig(BOOKS);
  const ledger = computeMemberLedger({ member: { openingBalance: 130000 }, contributions: [], config, now: parseEatDate('2026-11-20') });
  assert.equal(ledger.required, ledger.weeksScored * 1500);
  assert.equal(ledger.weeklyChanged, false);
  assert.equal(ledger.weeklyAmount, 1500);
});

test('the week-by-week schedule reads each week against its own amount', () => {
  // A cycle that opened long enough ago that "now" is past week 101 whatever day the test runs, with a rise from 101.
  const settings = { cycleStartWeek: 92, weekAnchorDate: parseEatDate('2026-08-14'), weeklyAmount: 1500, chaiAmount: 100, weeklyAmountChanges: [{ fromWeek: 101, amount: 2000 }] };
  const config = resolveConfig(settings);
  const schedule = buildWeeklySchedule(config, (w) => (w >= 101 ? 2000 : 1500), []);
  const byWeek = Object.fromEntries(schedule.map((w) => [w.weekNumber, w]));
  assert.equal(byWeek[92].expected, 0, 'the opening week asks nothing');
  assert.equal(byWeek[93].expected, 1500);
  assert.equal(byWeek[100].expected, 1500, 'the last week before the rise');
  assert.equal(byWeek[101].expected, 2000, 'the week the rise starts');
  // A plain number still works, as the tea (one amount) is passed.
  const tea = buildWeeklySchedule(config, 100, []);
  assert.ok(tea.filter((w) => !w.isBaseline).every((w) => w.expected === 100));
});
