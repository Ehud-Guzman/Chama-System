// A period statement: what it resolves to, and the one thing that makes it worth printing.
//
// The interesting tests here are the reconciliation ones. A period statement is only useful if its
// figures add up — opening, plus what came in, less what was due and the tea, equals closing — and
// that is the property a member or the committee will check first, on paper, in front of everybody.
// So most of what follows drives the real ledger engine over a synthetic member and asserts the
// identity exactly, including across a week boundary.
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePeriod, computePeriodBlock, eatToday } = require('../src/utils/statementPeriod');
const { resolveConfig, parseEatDate, toEatDateString } = require('../src/utils/weekCycle');

// 2026-01-02 is a Friday: the cycle opens on it and week 92 is the baseline.
const CONFIG = resolveConfig({
  cycleStartWeek: 92,
  weeklyAmount: 1400,
  chaiAmount: 100,
  weekAnchorDate: parseEatDate('2026-01-02'),
});

const NOW = parseEatDate('2026-06-30').getTime();
const day = (text) => parseEatDate(text).getTime();

// A member whose ledger is worth reconciling: carried-in money, a payment on some Thursdays, an
// overpaid week (credit), a missed month (arrears), tea on some weeks, and one row logged before the
// cycle opened.
function payments() {
  return [
    { amount: 5000, date: day('2025-06-06'), isGroupFund: false, type: 'Weekly contribution' },
    { amount: 1400, date: day('2026-01-08'), isGroupFund: false, type: 'Weekly contribution' },
    { amount: 1400, date: day('2026-01-15'), isGroupFund: false, type: 'Weekly contribution' },
    { amount: 100, date: day('2026-01-15'), isGroupFund: true, type: 'Chai' },
    { amount: 2000, date: day('2026-01-22'), isGroupFund: false, type: 'Weekly contribution' },
    // February: nothing at all, so those weeks close unpaid and arrears accrue.
    { amount: 1400, date: day('2026-03-05'), isGroupFund: false, type: 'Weekly contribution' },
    { amount: 3000, date: day('2026-04-02'), isGroupFund: false, type: 'Extra savings' },
    { amount: 1400, date: day('2026-05-07'), isGroupFund: false, type: 'Weekly contribution' },
    { amount: 100, date: day('2026-05-07'), isGroupFund: true, type: 'Chai' },
  ];
}

const MEMBER = { openingBalance: 12000, joinDate: day('2025-04-01') };

const blockFor = (query) => {
  const period = resolvePeriod(query, { now: NOW });
  assert.equal(period.error, undefined, period.error);
  const rows = payments().map((row) => ({
    ...row,
    bucket: row.isGroupFund ? 'chai' : 'weekly',
  }));
  return computePeriodBlock({
    member: MEMBER,
    config: CONFIG,
    all: rows,
    visible: rows.filter((row) => !row.isGroupFund),
    period,
    now: NOW,
  });
};

// -----------------------------------------------------------------------------
// What a query resolves to
// -----------------------------------------------------------------------------

test('nothing asked for means the whole book, exactly as before', () => {
  // This is what keeps every existing statement link working: no period, no period section.
  assert.equal(resolvePeriod({}, { now: NOW }), null);
  assert.equal(resolvePeriod({ unrelated: 'x' }, { now: NOW }), null);
});

test('a year is January to December, both ends inclusive', () => {
  const period = resolvePeriod({ year: '2025' }, { now: NOW });
  assert.equal(period.fromDate, '2025-01-01');
  assert.equal(period.toDate, '2025-12-31');
  assert.equal(period.label, '2025-01-01 to 2025-12-31');

  const last = resolvePeriod({ range: 'last-year' }, { now: NOW });
  assert.equal(last.fromDate, '2025-01-01');
  assert.equal(last.toDate, '2025-12-31');
});

test('a quarter is three months, and rolls back a year when it has to', () => {
  const q2 = resolvePeriod({ year: '2026', quarter: '2' }, { now: NOW });
  assert.equal(q2.fromDate, '2026-04-01');
  assert.equal(q2.toDate, '2026-06-30');
  assert.equal(q2.what, 'Q2 2026');

  // June 2026 is in Q2, so "this quarter" is Q2 and "last quarter" is Q1 of the same year.
  assert.equal(resolvePeriod({ range: 'this-quarter' }, { now: NOW }).what, 'Q2 2026');
  assert.equal(resolvePeriod({ range: 'last-quarter' }, { now: NOW }).what, 'Q1 2026');

  // And in January, "last quarter" is Q4 of the *previous* year — the case a hand-written date
  // range gets wrong.
  const january = parseEatDate('2026-01-15').getTime();
  const rolled = resolvePeriod({ range: 'last-quarter' }, { now: january });
  assert.equal(rolled.what, 'Q4 2025');
  assert.equal(rolled.fromDate, '2025-10-01');
  assert.equal(rolled.toDate, '2025-12-31');
});

test('a month is one month, and last-month rolls the year back in January', () => {
  assert.equal(resolvePeriod({ year: '2026', month: '2' }, { now: NOW }).toDate, '2026-02-28');
  assert.equal(resolvePeriod({ range: 'this-month' }, { now: NOW }).what, 'Jun 2026');

  const january = parseEatDate('2026-01-15').getTime();
  const december = resolvePeriod({ range: 'last-month' }, { now: january });
  assert.equal(december.what, 'Dec 2025');
  assert.equal(december.fromDate, '2025-12-01');
  assert.equal(december.toDate, '2025-12-31');

  // A leap year, asked for from *after* it: February's last day is a hand-written end-of-month's
  // classic bug. The `now` has to be later than the period, or the clamp below correctly shortens it.
  const in2029 = parseEatDate('2029-01-15').getTime();
  assert.equal(resolvePeriod({ year: '2028', month: '2' }, { now: in2029 }).toDate, '2028-02-29');
  assert.equal(resolvePeriod({ year: '2027', month: '2' }, { now: in2029 }).toDate, '2027-02-28');
});

test('a period that has not finished is clamped to today, and says so', () => {
  const running = resolvePeriod({ year: '2027' }, { now: NOW });
  assert.equal(running.toDate, '2026-06-30');
  assert.match(running.note, /had not finished/);
  assert.equal(running.openEnded, true);

  const finished = resolvePeriod({ year: '2025' }, { now: NOW });
  assert.equal(finished.note, '');
  assert.equal(finished.openEnded, false);
});

test('a period that cannot be understood is refused with a sentence, not a throw', () => {
  const bad = [
    { from: '2026-02-31' }, // passes a regex, is not a date
    { from: 'not-a-date' },
    { from: '2026-06-01', to: '2026-05-01' }, // backwards
    { to: '2026-05-01' }, // no start
    { year: '26' },
    { year: '1899' },
    { quarter: '5' },
    { month: '13' },
    { range: 'forever' },
  ];
  for (const query of bad) {
    const result = resolvePeriod(query, { now: NOW });
    assert.ok(result.error, `expected ${JSON.stringify(query)} to be refused`);
    assert.equal(typeof result.error, 'string');
  }
  // The message names what is allowed, because an operator reads it on a 400.
  assert.match(resolvePeriod({ range: 'forever' }, { now: NOW }).error, /this-year/);
});

// -----------------------------------------------------------------------------
// The figures — the part that has to add up
// -----------------------------------------------------------------------------

test('the period reconciles: opening plus in, less due and tea, equals closing', () => {
  const block = blockFor({ year: '2026' });

  // Both ends are the member's real position at that instant, from the same engine the passbook
  // uses — not a sum of the rows in between.
  assert.equal(typeof block.opening, 'number');
  assert.equal(typeof block.closing, 'number');
  assert.equal(block.balanced, true);
  assert.equal(block.accountedFor, block.movement);

  // Spelled out, exactly as the statement prints it, so a reader can check it by hand.
  assert.equal(
    Math.round((block.opening + block.paidIn - block.required - block.tea) * 100) / 100,
    block.closing
  );
});

test('it reconciles for every shape of period, including one week wide', () => {
  const queries = [
    { year: '2026' },
    { year: '2025' },
    { range: 'this-quarter' },
    { range: 'last-quarter' },
    { range: 'this-month' },
    { year: '2026', month: '1' },
    { year: '2026', month: '2' }, // a month with no payments at all
    { from: '2026-01-02', to: '2026-01-08' }, // exactly one week: Friday to the Thursday
    { from: '2026-01-01', to: '2026-01-02' }, // a single day, the opening Friday
    { from: '2025-06-01', to: '2025-06-30' }, // entirely before the cycle opened
    { from: '2025-01-01', to: '2026-06-30' }, // straddling the cycle opening
  ];
  for (const query of queries) {
    const block = blockFor(query);
    assert.equal(
      block.balanced,
      true,
      `${JSON.stringify(query)}: opening ${block.opening} + ${block.paidIn} − ${block.required} − ${block.tea} = ${block.accountedFor}, but closing is ${block.closing}`
    );
  }
});

test('a month inside the cycle carries its own weeks, and neither baseline nor running week scores', () => {
  const year = blockFor({ year: '2026' });
  const january = blockFor({ year: '2026', month: '1' });

  // January opens where 2025 left him — the same figure the year's statement opens with, because
  // both begin before any week of the cycle has been scored.
  assert.equal(january.opening, year.opening);

  // January 2026 holds weeks 92 to 96. Week 92 is the opening week and is never scored (its money is
  // inside the carried-in balance), and week 96 is still running on 31 January, so **three** weeks
  // score in the month: 93, 94 and 95.
  assert.equal(january.weeksClosed, 3);
  assert.equal(january.required, 4200);
  assert.equal(january.tea, 300);

  // February scores four — the Thursdays of the 5th, 12th, 19th and 26th.
  const february = blockFor({ year: '2026', month: '2' });
  assert.equal(february.weeksClosed, 4);
  assert.equal(february.required, 5600);
  assert.equal(february.tea, 400);

  // A month nothing was paid in still accrues what was due: `paidIn` is 0 and the movement is the
  // weeks that closed, which is what arrears are made of.
  assert.equal(february.paidIn, 0);
  assert.equal(february.contributionsCount, 0);
  assert.equal(february.movement, -5600 - 400);

  // The weeks and the tea always move together, and the tea is a whole number of weeks' worth: the
  // engine charges tea for exactly the weeks it scores, so this can never drift apart.
  for (const block of [january, february, year, blockFor({ range: 'this-quarter' })]) {
    assert.equal(block.tea, block.weeksClosed * 100, `${block.label}: tea does not match weeks`);
    assert.equal(block.required, block.weeksClosed * 1400, `${block.label}: required does not match weeks`);
  }
});

test('the months listed are the months the period touches', () => {
  // A finished year lists all twelve.
  assert.equal(blockFor({ year: '2025' }).monthly.length, 12);
  assert.equal(blockFor({ year: '2026', month: '3' }).monthly.length, 1);
  assert.equal(blockFor({ year: '2026', quarter: '2' }).monthly.length, 3);

  // A year still running is clamped to today and lists only the months that have happened — six of
  // them, to June. The alternative would be five months of zeroes reading as five months of failure.
  const running = blockFor({ year: '2026' });
  assert.equal(running.monthly.length, 6);
  assert.equal(running.monthly[running.monthly.length - 1].label, 'Jun 2026');

  const quarter = blockFor({ year: '2026', quarter: '2' });
  assert.deepEqual(
    quarter.monthly.map((month) => month.label),
    ['Apr 2026', 'May 2026', 'Jun 2026']
  );
  // A month's money is listed under its own month, and a month with nothing is listed with a zero
  // rather than omitted — a gap in a statement reads as a printing error.
  assert.equal(quarter.monthly.find((m) => m.label === 'May 2026').amount, 1400);
  assert.equal(quarter.monthly.find((m) => m.label === 'Jun 2026').amount, 0);
  assert.equal(quarter.monthlyTotal, 4400);
});

test('the period lists only the rows inside it', () => {
  const march = blockFor({ year: '2026', month: '3' });
  assert.equal(march.contributions.length, 1);
  assert.equal(toEatDateString(new Date(march.contributions[0].date)), '2026-03-05');

  // The by-type breakdown covers the period, not the book.
  assert.equal(march.byType.length, 1);
  assert.equal(march.byType[0].contributed, 1400);
  assert.equal(march.byType[0].share, 100);

  // The year's rows are only the year's: six of them, and the tea rows are not among them because
  // `visible` excludes them for a member's own copy.
  const year = blockFor({ year: '2026' });
  assert.equal(year.contributionsCount, 6);
  assert.equal(
    year.contributions.every((row) => new Date(row.date).getTime() >= parseEatDate('2026-01-01').getTime()),
    true
  );

  // The one row logged before the cycle opened is in the 2025 statement, and nowhere else.
  const lastYear = blockFor({ year: '2025' });
  assert.equal(lastYear.contributions.length, 1);
  assert.equal(lastYear.contributions[0].amount, 5000);
  assert.equal(year.contributions.some((row) => row.amount === 5000), false);
});

test('a period statement still says what he holds today', () => {
  const march = blockFor({ year: '2026', month: '3' });

  // The whole book, as one period that ends today: its closing IS today's position.
  const everything = computePeriodBlock({
    member: MEMBER,
    config: CONFIG,
    all: payments().map((row) => ({ ...row, bucket: row.isGroupFund ? 'chai' : 'weekly' })),
    visible: payments().filter((row) => !row.isGroupFund),
    period: resolvePeriod({ from: '2025-01-01' }, { now: NOW }),
    now: NOW,
  });
  assert.equal(march.asAtToday, everything.closing);

  // And March's own closing is not today's position, because the rest of the year happened after it.
  assert.notEqual(march.closing, march.asAtToday);
});

test('the eatToday helper agrees with the engine about the calendar', () => {
  // 21:30 UTC on 2 January is already 3 January in Nairobi, and a statement asked for "today" at
  // that moment must be for the 3rd.
  assert.equal(eatToday(Date.UTC(2026, 0, 2, 21, 30)), '2026-01-03');
  assert.equal(eatToday(Date.UTC(2026, 0, 2, 20, 30)), '2026-01-02');
});

