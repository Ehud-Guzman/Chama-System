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
const { computeMemberLedger, summariseMember, totalLedger } = require('../src/utils/memberLedger');

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

// ---------------------------------------------------------------------------------------------
// Behind is money, not a deadline
//
// `settled` is the paper ledger's weekly column — was that week's money in by its Thursday — and
// the §7.5 NILL fine is built on it. `behind` is the question a reminder, a statement and the
// member's own passbook all have to answer the same way: is any of it still owing? A payment that
// arrives after a missed Thursday clears the shortfall, so the week stops being a debt even though
// it was never paid in its own week. These tests pin both halves, and the invariant that ties them
// together: what the weeks say is owed adds up to the arrears.
// ---------------------------------------------------------------------------------------------

const PAY_DATE = parseEatDate('2026-10-02'); // the Friday that opens week 95

// A row dated inside week 94, i.e. after week 93's Thursday had passed.
const paidInWeek94 = (amount) => ({
  _id: `contribution-${amount}`,
  amount,
  grossAmount: null,
  date: parseEatDate('2026-09-25'),
  bucket: 'weekly',
  isGroupFund: false,
});

const owedByWeek = (ledger) => ledger.weeks.map((w) => w.owed);
const sumOwed = (ledger) => owedByWeek(ledger).reduce((sum, n) => sum + n, 0);

test('a week paid late is behind in the paper column and not a debt', () => {
  // 3,000 handed over the day after week 93 had closed: week 93 was NILL (nothing came in that
  // week), the money has since covered it, and nothing is owed. This is the case that used to be
  // emailed as "Week 93 — 1,400 short" while the same member's passbook said he owed nothing.
  const ledger = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [paidInWeek94(3000)],
    config,
    now: PAY_DATE,
  });

  const week93 = weekOf(ledger, 93);
  assert.equal(week93.status, 'nill', 'nothing was paid during week 93');
  assert.equal(week93.settled, false, 'and the weekly column says so');
  assert.equal(week93.nillFineDue, true, '§7.5 fines the deadline, which was missed');

  assert.equal(ledger.arrears, 0, 'but he owes nothing');
  assert.equal(ledger.weeksBehind, 0, 'so he is not behind');
  assert.equal(week93.behind, false);
  assert.equal(week93.owed, 0);
  assert.equal(sumOwed(ledger), ledger.arrears);
});

test('the weeks that are owed are the ones the money is short of, oldest first', () => {
  const nothing = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [],
    config,
    now: PAY_DATE,
  });
  assert.equal(nothing.arrears, 2800);
  assert.equal(nothing.weeksBehind, 2);
  assert.deepEqual(owedByWeek(nothing), [0, 1400, 1400, 0], 'baseline, week 93, week 94, running');
  assert.equal(sumOwed(nothing), nothing.arrears);

  // 1,400 on the Friday after week 93 closed: it pays for the week it landed in, so week 93 is
  // still the week owed and week 94 is not.
  const settledLater = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [paidInWeek94(1400)],
    config,
    now: PAY_DATE,
  });
  assert.equal(settledLater.arrears, 1400);
  assert.equal(settledLater.weeksBehind, 1);
  assert.deepEqual(owedByWeek(settledLater), [0, 1400, 0, 0]);
  assert.equal(sumOwed(settledLater), settledLater.arrears);

  // 500 of it: week 93's 1,400 is still owed first, and only part of week 94's gap is left.
  const partWay = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [paidInWeek94(500)],
    config,
    now: PAY_DATE,
  });
  assert.equal(partWay.arrears, 2300);
  assert.equal(partWay.weeksBehind, 2);
  assert.deepEqual(owedByWeek(partWay), [0, 1400, 900, 0]);
  assert.equal(sumOwed(partWay), partWay.arrears, 'the weeks add up to the arrears, to the shilling');
});

test('a week nobody paid at all is behind, exactly as the arrears say', () => {
  // The ordinary case, so the rule above cannot quietly stop reporting anyone.
  const ledger = computeMemberLedger({
    member: { openingBalance: 12000 },
    contributions: [],
    config,
    now: parseEatDate('2026-09-25'), // one week closed, as the live books stand today
  });

  assert.equal(ledger.arrears, 1400);
  assert.equal(ledger.weeksBehind, 1);
  // The walk's own looseness, left exactly as it was: it counts the week still running as well
  // (nothing has settled it yet — its Thursday is still to come), which is why no screen reads
  // this field as "weeks owing". `weeksBehind` above is the one that means a debt.
  assert.equal(ledger.weeksUnsettled, 2);
  assert.equal(weekOf(ledger, 93).owed, 1400);
  assert.equal(weekOf(ledger, 93).behind, true);
  assert.equal(sumOwed(ledger), ledger.arrears);
  // Every screen reads these two together, so they may never disagree: the count of weeks and the
  // money are one statement.
  assert.equal(summariseMember({ _id: 'm1', name: 'A', active: true }, ledger).weeksBehind, 1);
});

// ---------------------------------------------------------------------------------------------
// The group's line: what he is *told*, beside what the weeks say
//
// `arrears` and `weeksBehind` are the record — he missed a week and 1,400 of it is unpaid — and the
// chased pair is the policy: a member holding at least Settings.reminderMoneyLimit has paid more
// into the cycle than it has asked of him, and the group decided he is not told he is behind
// (utils/reminderLimit). Every screen that shows the word "behind" reads the chased pair, so the
// member's passbook, the office's list and the register cannot say different things about him.
// ---------------------------------------------------------------------------------------------

const configNoLine = resolveConfig({
  cycleStartWeek: 92,
  weeklyAmount: 1400,
  chaiAmount: 100,
  weekAnchorDate: parseEatDate('2026-09-11'),
  reminderMoneyLimit: 0,
});

const HOLDING_THE_LINE = parseEatDate('2026-09-25'); // week 94: line = 114,600 + 2 × 1,400

test('above the line the weeks are still the record and nothing is chased', () => {
  const ledger = computeMemberLedger({
    member: { openingBalance: 200000 },
    contributions: [],
    config,
    now: HOLDING_THE_LINE,
  });

  assert.equal(ledger.moneyLimit, 117400, 'the line moves 1,400 a week from week 92');
  assert.equal(ledger.coveredByBalance, true);
  assert.equal(ledger.arrears, 1400, 'the record is untouched');
  assert.equal(ledger.weeksBehind, 1);
  assert.equal(ledger.money, 199900, 'and so is the money');
  assert.equal(ledger.chasedArrears, 0, 'but nothing is asked of him');
  assert.equal(ledger.chasedWeeksBehind, 0);

  const summary = summariseMember({ _id: 'm1', name: 'A', active: true }, ledger);
  assert.equal(summary.chasedArrears, 0);
  assert.equal(summary.chasedWeeksBehind, 0);
  assert.equal(summary.moneyLimit, 117400);
});

test('below the line what is chased is simply what is owed', () => {
  const ledger = computeMemberLedger({
    member: { openingBalance: 50000 },
    contributions: [],
    config,
    now: HOLDING_THE_LINE,
  });

  assert.equal(ledger.coveredByBalance, false);
  assert.equal(ledger.chasedArrears, ledger.arrears);
  assert.equal(ledger.chasedWeeksBehind, ledger.weeksBehind);
  assert.equal(ledger.chasedArrears, 1400);
});

test('a line of 0 is off: everybody who is behind is told', () => {
  const ledger = computeMemberLedger({
    member: { openingBalance: 200000 },
    contributions: [],
    config: configNoLine,
    now: HOLDING_THE_LINE,
  });

  assert.equal(ledger.moneyLimit, 0);
  assert.equal(ledger.coveredByBalance, false);
  assert.equal(ledger.chasedArrears, 1400, 'holding a fortune is no defence when the group says so');
});

test('the header keeps both halves of what is owed', () => {
  const rich = computeMemberLedger({
    member: { openingBalance: 200000 },
    contributions: [],
    config,
    now: HOLDING_THE_LINE,
  });
  const poor = computeMemberLedger({
    member: { openingBalance: 1000 },
    contributions: [],
    config,
    now: HOLDING_THE_LINE,
  });
  const totals = totalLedger([rich, poor]);

  assert.equal(totals.arrears, 2800, 'both members owe a week');
  assert.equal(totals.chasedArrears, 1400, 'only one of them is being asked for it');
  assert.equal(totals.notChasedArrears, 1400, 'and the other half is named, not lost');
});
