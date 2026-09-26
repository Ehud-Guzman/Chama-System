// The per-week attribution behind the weekly reconciliation.
//
// A week's money is read off each member's own ledger row — `personalPaid`, the
// weekly contribution plus anything extra, dated inside that week — and then
// summed into the fund line above the names. This file pins the case that reads
// like a bug on the screen: week 93 with two members paid in and thirty not yet,
// where the fund line says Ksh 9,000 and every name in the roster underneath it
// reads zero. Both figures are right — that roster names only the members who
// still owe — and the sum of the rows has to equal the line above them, or the
// reconciliation is worth nothing.
//
// No database: computeMemberLedger is a pure function over a settings config.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseEatDate, resolveConfig } = require('../src/utils/weekCycle');
const { computeMemberLedger, summariseMember } = require('../src/utils/memberLedger');

// 2026-09-11 is the Friday week 92 opens on, which makes week 93 Fri 18 Sep →
// Thu 24 Sep — the week these figures were read off the live books.
const config = resolveConfig({
  cycleStartWeek: 92,
  weeklyAmount: 1400,
  chaiAmount: 100,
  weekAnchorDate: parseEatDate('2026-09-11'),
});

const WEEK_93_FRIDAY = parseEatDate('2026-09-18');

// Contributions arrive annotated by the caller, as the ledger documents:
// `bucket` and `isGroupFund` are decided once, from the type.
const weekly = (amount) => ({
  _id: `contribution-${amount}`,
  amount,
  grossAmount: null,
  date: WEEK_93_FRIDAY,
  bucket: 'weekly',
  isGroupFund: false,
});

const ledgerFor = (contributions, openingBalance = 0) =>
  computeMemberLedger({
    member: { openingBalance },
    contributions,
    config,
    now: WEEK_93_FRIDAY,
  });

const weekOf = (ledger, weekNumber) => ledger.weeks.find((w) => w.weekNumber === weekNumber);

test('a payment dated inside the running week lands on that week', () => {
  const ledger = ledgerFor([weekly(4000)]);
  const week = weekOf(ledger, 93);
  assert.equal(ledger.currentWeek, 93);
  assert.equal(week.isCurrent, true);
  assert.equal(week.personalPaid, 4000);
  assert.equal(week.status, 'paid');
});

test('the running week is never late, however little of it is in', () => {
  // Nothing is scored yet — week 92 is the baseline and week 93 has not closed —
  // so a member who has paid nothing owes nothing *yet*.
  const ledger = ledgerFor([]);
  assert.equal(ledger.required, 0);
  assert.equal(ledger.arrears, 0);
  assert.equal(ledger.weeksBehind, 0);
  // The row still exists and still reads zero: a NILL week is a status, not an
  // absence of data (§7.4).
  assert.equal(weekOf(ledger, 93).status, 'nill');
  assert.equal(weekOf(ledger, 93).personalPaid, 0);
});

test('the fund line and the names under it are the same money', () => {
  // 32 members, two of them in early (5,000 and 4,000), so the week reads
  // Ksh 9,000 collected, 2/32 paid in full, 30 short.
  const ledgers = [
    ledgerFor([weekly(5000)]),
    ledgerFor([weekly(4000)]),
    ...Array.from({ length: 30 }, () => ledgerFor([])),
  ];
  const paidForWeek93 = ledgers.map((l) => weekOf(l, 93).personalPaid);

  // The fund line: what every member's own row adds up to — the figure the
  // report prints beside the fund name.
  assert.equal(paidForWeek93.reduce((sum, paid) => sum + paid, 0), 9000);
  // Two members met their minimum this week.
  assert.equal(paidForWeek93.filter((paid) => paid >= config.weeklyAmount).length, 2);
  // The other thirty are the roster printed underneath, and every one of them
  // reads zero — which is why the roster alone leaves the 9,000 on the line
  // unexplained until the members who paid are named too.
  const shortfall = paidForWeek93.filter((paid) => paid < config.weeklyAmount);
  assert.equal(shortfall.length, 30);
  assert.deepEqual(shortfall, Array(30).fill(0));
});

test('an overpayment stays on the week it was made in as credit', () => {
  // 4,000 in a 1,400 week is 2,600 of surplus, not a week the ledger talks
  // itself out of: the row keeps the whole amount so the fund line and the
  // member's own page show the same figure (§7.5 accumulates the credit later).
  const ledger = ledgerFor([weekly(4000)]);
  assert.equal(weekOf(ledger, 93).personalPaid, 4000);
  assert.equal(ledger.paid, 4000);
  assert.equal(ledger.movement, 4000); // nothing scored yet, so no requirement to offset
});

test('the list projection carries the engine\'s own closed-week count', () => {
  // The member list's pill reads this to know whether "settled" is a thing yet:
  // while it is 0 no week has closed, so nobody owes and nobody has settled.
  const member = { _id: 'm1', name: 'A Member', active: true };
  assert.equal(summariseMember(member, ledgerFor([])).weeksScored, 0);
  assert.equal(summariseMember(member, ledgerFor([weekly(4000)])).weeksScored, 0);

  // The day after week 93's Thursday, one week has closed — the same moment
  // every unpaid member becomes 1,400 behind.
  const nextFriday = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [],
    config,
    now: parseEatDate('2026-09-25'),
  });
  assert.equal(summariseMember(member, nextFriday).weeksScored, 1);
  assert.equal(summariseMember(member, nextFriday).arrears, 1400);
});

test('a closed week nobody paid is reported as owed, never taken off his money', () => {
  // The week that closed on 24 September was not paid, so 1,400 is owed and the week's 100 of tea
  // is the only money that leaves him. This is the rule the paper ledger's total column held
  // ("Previous + Weekly + Extra − Chai"), and the figure the group is actually holding for him.
  const ledger = computeMemberLedger({
    member: { openingBalance: 5000 },
    contributions: [],
    config,
    now: parseEatDate('2026-09-25'),
  });

  assert.equal(ledger.weeksScored, 1);
  assert.equal(ledger.required, 1400, 'one week has closed and was expected of him');
  assert.equal(ledger.arrears, 1400, 'and it was not paid');
  assert.equal(ledger.chai.due, 100);
  assert.equal(ledger.money, 4900, 'he still holds what he brought in, less the tea');
  assert.equal(ledger.moneyNetOfDues, 3500);
  // The bridge the office reconciles an older statement with: the figure the books showed while
  // the expectation was still being deducted is today's figure less the weeks that have closed.
  assert.equal(ledger.moneyNetOfDues, ledger.money - ledger.required);
});

test('paying a later week does not move what he holds by more than was paid', () => {
  // Two closed weeks of expectation against one payment of 4,000: the surplus is credit (§7.5),
  // not a bigger balance, and nothing that was never collected appears in the held figure.
  const ledger = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [weekly(4000)],
    config,
    // The Friday after week 94's Thursday: weeks 93 and 94 have closed.
    now: parseEatDate('2026-10-02'),
  });

  assert.equal(ledger.required, 2800);
  assert.equal(ledger.paid, 4000);
  assert.equal(ledger.arrears, 0);
  assert.equal(ledger.credit, 1200);
  assert.equal(ledger.chai.due, 200);
  assert.equal(ledger.money, 3800, '4,000 paid in, less two weeks of tea — and nothing else');
  assert.equal(ledger.moneyNetOfDues, 1000, 'the old figure: the same money, less the 2,800 due');
});
