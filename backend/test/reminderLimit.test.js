// The line the group stops chasing at: who is not told he is behind.
//
// This is a policy that decides who gets an email and nothing else, so it is tested where it is
// decided — as a pure function of (what he holds, where the line is) — and it is tested for the
// two things a wrong implementation would silently get wrong: a line that does not move with the
// cycle (which stops excluding anybody within a fortnight) and a line that does move when the
// group meant it off.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MONEY_LIMIT,
  MONEY_LIMIT_CEILING,
  normaliseMoneyLimit,
  normaliseMoneyLimitWeek,
  lineStep,
  moneyLimitForWeek,
  coveredByBalance,
} = require('../src/utils/reminderLimit');

// The group's own cycle: week 92 opens on the Friday the books did, 1,400 a week.
const config = { cycleStartWeek: 92, weeklyAmount: 1400 };

test('the line is the treasurer\'s own figure in week 92 and 1,400 higher every week after', () => {
  const settings = { reminderMoneyLimit: 114600, reminderMoneyLimitWeek: null };

  // Week 92 is the week the figure was given for, so it reads exactly as typed.
  assert.equal(moneyLimitForWeek(settings, config, 92), 114600);
  assert.equal(moneyLimitForWeek(settings, config, 93), 116000);
  assert.equal(moneyLimitForWeek(settings, config, 94), 117400);
  assert.equal(moneyLimitForWeek(settings, config, 95), 118800);
});

test('a line set for a later week is not back-dated', () => {
  // A group that re-measures the figure in week 96 and types 130,000 means 130,000 from week 96,
  // not 130,000 minus three weeks' worth in week 93.
  const settings = { reminderMoneyLimit: 130000, reminderMoneyLimitWeek: 96 };
  assert.equal(moneyLimitForWeek(settings, config, 92), 130000);
  assert.equal(moneyLimitForWeek(settings, config, 96), 130000);
  assert.equal(moneyLimitForWeek(settings, config, 97), 131400);
});

test('zero switches the line off, and then nobody is left alone for holding money', () => {
  const settings = { reminderMoneyLimit: 0, reminderMoneyLimitWeek: null };
  assert.equal(moneyLimitForWeek(settings, config, 94), 0);
  // Not "everybody above zero" — a member holding half a million is still told he is behind when
  // the group has said it wants that.
  assert.equal(coveredByBalance(500000, moneyLimitForWeek(settings, config, 94)), false);
});

test('at or above the line is left alone; a shilling below it is not', () => {
  const limit = moneyLimitForWeek({ reminderMoneyLimit: 114600 }, config, 92);
  assert.equal(coveredByBalance(114600, limit), true);
  assert.equal(coveredByBalance(114599, limit), false);
  assert.equal(coveredByBalance(0, limit), false);
  // Nothing to compare against: no member is covered by a line that does not exist.
  assert.equal(coveredByBalance(999999, 0), false);
});

test('a stored value is coerced, and blank never means zero', () => {
  // '114600' > 114600 is false in JavaScript for a string on the left, which would silently stop
  // excluding the members the treasurer meant to exclude. Numbers are read from the database, so
  // the coercion happens on the way in as well as on the way out.
  assert.equal(normaliseMoneyLimit('114600'), 114600);
  // The same formats the ledger screen accepts, because the same person types into both.
  assert.equal(normaliseMoneyLimit(' 114,600 '), 114600);
  assert.equal(normaliseMoneyLimit('Ksh 120,000'), 120000);
  assert.equal(normaliseMoneyLimit(114600.4), 114600);
  // A box tabbed through must not undo the group's policy.
  assert.equal(normaliseMoneyLimit(''), DEFAULT_MONEY_LIMIT);
  assert.equal(normaliseMoneyLimit(undefined), DEFAULT_MONEY_LIMIT);
  assert.equal(normaliseMoneyLimit(null), DEFAULT_MONEY_LIMIT);
  assert.equal(normaliseMoneyLimit('nonsense'), DEFAULT_MONEY_LIMIT);
  assert.equal(normaliseMoneyLimit(-1), DEFAULT_MONEY_LIMIT);
  // And a figure above every balance is capped rather than obeyed.
  assert.equal(normaliseMoneyLimit(MONEY_LIMIT_CEILING + 1), MONEY_LIMIT_CEILING);
});

test('the week the figure was measured in falls back to the cycle\'s opening week', () => {
  assert.equal(normaliseMoneyLimitWeek(null), null);
  assert.equal(normaliseMoneyLimitWeek(''), null);
  assert.equal(normaliseMoneyLimitWeek('92'), 92);
  assert.equal(normaliseMoneyLimitWeek(92.5), null);
  assert.equal(normaliseMoneyLimitWeek('ninety-two'), null);
  assert.equal(normaliseMoneyLimitWeek(0), null);

  // Which is what makes a fresh install need one number and not two.
  assert.equal(
    moneyLimitForWeek({ reminderMoneyLimit: 114600 }, config, 93),
    moneyLimitForWeek({ reminderMoneyLimit: 114600, reminderMoneyLimitWeek: 92 }, config, 93)
  );
});

// The line rises by what a member who pays in full actually gains: the contribution less the tea.
test('the line rises by the contribution less the tea', () => {
  const settings = { reminderMoneyLimit: 114600 };
  const net = { cycleStartWeek: 92, weeklyAmount: 1500, chaiAmount: 100 };

  assert.equal(lineStep(net), 1400);
  assert.equal(moneyLimitForWeek(settings, net, 92), 114600);
  assert.equal(moneyLimitForWeek(settings, net, 93), 116000);
  assert.equal(moneyLimitForWeek(settings, net, 94), 117400);
  // No tea set, or tea larger than the contribution: never a line that falls.
  assert.equal(lineStep({ weeklyAmount: 1400 }), 1400);
  assert.equal(lineStep({ weeklyAmount: 50, chaiAmount: 100 }), 0);
});

test('a member who pays every week stays on the line, week after week', () => {
  const { computeMemberLedger } = require('../src/utils/memberLedger');
  const { resolveConfig, weekRange } = require('../src/utils/weekCycle');
  const settings = {
    weekAnchorDate: new Date('2026-07-03T00:00:00+03:00'),
    cycleStartWeek: 92,
    weeklyAmount: 1500,
    chaiAmount: 100,
    reminderMoneyLimit: 114600,
  };
  const cfg = resolveConfig(settings);

  for (const week of [93, 94, 102, 112]) {
    const contributions = [];
    for (let w = 93; w <= week; w++) {
      contributions.push({
        _id: `c${w}`,
        bucket: 'weekly',
        isGroupFund: false,
        amount: 1500,
        date: new Date(weekRange(w, cfg).startDate.getTime() + 86400000),
      });
    }
    const now = weekRange(week, cfg).startDate.getTime() + 3 * 86400000;
    const ledger = computeMemberLedger({ member: { openingBalance: 114600 }, contributions, config: cfg, now });
    assert.equal(ledger.weeksBehind, 0, `week ${week}: nothing unpaid`);
    assert.ok(ledger.money >= ledger.moneyLimit, `week ${week}: holds ${ledger.money}, line ${ledger.moneyLimit}`);
  }
});
