// Where this week stands — the card that replaced the twelve-week trend chart on the summary.
//
// The chart failed the only test that matters for a figure on a screen: it did not change what
// anybody did next. Every bar was the same height, because every active member pays the same weekly
// amount. These checks pin the rule that *does* answer a question: how much of this week's asking has
// come in, and how many members are still to bring it.
//
// No database: rows are one line per member who has paid something this week.
const test = require('node:test');
const assert = require('node:assert/strict');

const { summariseWeekProgress } = require('../src/utils/weekProgress');

const roster = ['a', 'b', 'c', 'd'];
const WEEKLY = 1400;

const progressOf = (rows, { expected = WEEKLY * 4, members = roster } = {}) =>
  summariseWeekProgress({ rows, activeMemberIds: members, expected, weeklyAmount: WEEKLY });

test('a week nobody has paid yet asks for the whole roster and says so', () => {
  const week = progressOf([]);
  assert.equal(week.members, 4);
  assert.equal(week.expected, 5600);
  assert.equal(week.paid, 0);
  assert.equal(week.shortfall, 5600);
  assert.equal(week.percent, 0);
  assert.equal(week.paidCount, 0);
  assert.equal(week.partialCount, 0);
  assert.equal(week.noneCount, 4, 'all four are still to pay');
  assert.equal(week.settled, false);
});

test('a part of the week in reads as a part of the week in', () => {
  // Two members in full, one part-paid, one silent: Ksh 3,500 of 5,600.
  const week = progressOf([
    { _id: 'a', paid: 1400 },
    { _id: 'b', paid: 1400 },
    { _id: 'c', paid: 700 },
  ]);
  assert.equal(week.paid, 3500);
  assert.equal(week.paidCount, 2);
  assert.equal(week.partialCount, 1, 'the 700 is not nobody and not the week either');
  assert.equal(week.noneCount, 1);
  assert.equal(week.shortfall, 2100);
  assert.equal(week.percent, 63);
  assert.equal(week.settled, false);
});

test('a week that is in full is settled, and the bar does not overrun', () => {
  const week = progressOf(
    roster.map((id) => ({ _id: id, paid: 1400 }))
  );
  assert.equal(week.paid, 5600);
  assert.equal(week.shortfall, 0);
  assert.equal(week.percent, 100);
  assert.equal(week.noneCount, 0);
  assert.equal(week.settled, true);
});

test('somebody paying above the week does not make the bar lie', () => {
  // 2,000 from one member covers his week and 600 of the gap; the bar reads 100% and the shortfall
  // is 0, rather than a bar that runs off its own track.
  const week = progressOf([
    { _id: 'a', paid: 2000 },
    { _id: 'b', paid: 1400 },
    { _id: 'c', paid: 1000 },
    { _id: 'd', paid: 1400 },
  ]);
  assert.equal(week.paid, 5800);
  assert.equal(week.shortfall, 0);
  assert.equal(week.percent, 100);
  assert.equal(week.paidCount, 3, 'a 1,000 payment is not a full week');
  assert.equal(week.partialCount, 1);
});

test('a payment from somebody who is no longer a member is money, not a member', () => {
  // He left; his money did not. It comes off what the week is short, and it is not counted among the
  // members the week is asking, because it is not going to be asked of him again.
  const week = progressOf([
    { _id: 'a', paid: 1400 },
    { _id: 'gone', paid: 1400 },
  ]);
  assert.equal(week.paid, 2800);
  assert.equal(week.shortfall, 2800);
  assert.equal(week.paidCount, 1);
  assert.equal(week.noneCount, 3, 'a, gone and the two silent ones are not the same thing');
});

test('a group with no weekly amount set is not a week that is settled', () => {
  // expected 0 is what a configuration with no weekly amount looks like. Nothing is short (there is
  // nothing to be short of) but nothing is settled either — the screen says the figures it has.
  const week = summariseWeekProgress({ rows: [], activeMemberIds: roster, expected: 0, weeklyAmount: 0 });
  assert.equal(week.percent, 0);
  assert.equal(week.shortfall, 0);
  assert.equal(week.settled, false);
});

test('the counts always add up to the roster', () => {
  const week = progressOf([
    { _id: 'a', paid: 1400 },
    { _id: 'b', paid: 100 },
  ]);
  assert.equal(week.paidCount + week.partialCount + week.noneCount, week.members);
});
