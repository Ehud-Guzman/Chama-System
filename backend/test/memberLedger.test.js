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
  // One payment of 4,000 in week 93 against two closed weeks: week 93 is settled, week 94 was never
  // paid for, and what he holds is what he handed over less the tea — nothing that was never
  // collected appears in it.
  const ledger = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [weekly(4000)],
    config,
    // The Friday after week 94's Thursday: weeks 93 and 94 have closed.
    now: parseEatDate('2026-10-02'),
  });

  assert.equal(ledger.required, 2800);
  assert.equal(ledger.paid, 4000);
  assert.equal(weekOf(ledger, 93).status, 'paid');
  assert.equal(weekOf(ledger, 94).status, 'nill', 'nothing was paid in week 94');
  assert.equal(ledger.chai.due, 200);
  assert.equal(ledger.money, 3800, '4,000 paid in, less two weeks of tea — and nothing else');
  assert.equal(ledger.moneyNetOfDues, 1000, 'the old figure: the same money, less the 2,800 due');
});

// ---------------------------------------------------------------------------------------------
// Every closed week stands on its own
//
// The weekly 1,400 is the *minimum* a week asks for, and what answers it is what he paid **in that
// week**. A surplus in one week is his money — it is not the next week's payment — so a week nobody
// paid is 1,400 short whatever he paid in some other week, and a member below the group's line is
// told he is short by 1,400 for it. That is also what the week table and the weekly reconciliation
// report show, and what the paper ledger's per-week columns said. The money he holds is never
// touched by any of it: it moves by what he actually handed over.
// ---------------------------------------------------------------------------------------------

const PAY_DATE = parseEatDate('2026-10-02'); // the Friday that opens week 95: 93 and 94 closed

const paidOn = (date, amount) => ({
  _id: `contribution-${date}-${amount}`,
  amount,
  grossAmount: null,
  date: parseEatDate(date),
  bucket: 'weekly',
  isGroupFund: false,
});

// A row dated inside week 94, i.e. after week 93's Thursday had passed.
const paidInWeek94 = (amount) => paidOn('2026-09-25', amount);

const shortByWeek = (ledger) => ledger.weeks.map((w) => w.shortfall);
// What the closed weeks add up to — the independent check on `arrears`, which is why it counts the
// closed weeks itself rather than reading the engine's `behind` flag. The week still running is
// left out: its 1,400 is money still to come, not money short (nobody is behind on a week whose
// Thursday has not passed).
const closedShort = (ledger) =>
  ledger.weeks
    .filter((w) => !w.isBaseline && !w.isCurrent)
    .reduce((sum, w) => sum + w.shortfall, 0);

test('a surplus in one week does not pay for the next', () => {
  // 2,000 in week 93 and nothing in week 94. The 600 above the minimum is his money, not week 94's
  // subscription, so week 94 is 1,400 short — the full weekly amount, not 800.
  const ledger = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [paidOn('2026-09-18', 2000)],
    config,
    now: PAY_DATE,
  });

  assert.equal(weekOf(ledger, 93).shortfall, 0, 'week 93 got its 1,400 — and 600 more');
  assert.equal(weekOf(ledger, 94).shortfall, 1400, 'week 94 asked its own 1,400 and got nothing');
  assert.equal(ledger.arrears, 1400, 'so he is short 1,400, not 800');
  assert.equal(ledger.weeksBehind, 1);
  assert.deepEqual(
    shortByWeek(ledger),
    [0, 0, 1400, 1400],
    'baseline, week 93, week 94, the week running — the last has its own money still to come'
  );
  assert.equal(closedShort(ledger), ledger.arrears);
  // And the money is untouched by any of it: 2,000 handed over, 200 of tea, 1,800 held.
  assert.equal(ledger.money, 1800);
});

test('a week paid late is still the week he missed', () => {
  // 3,000 handed over the day after week 93 had closed: nothing came in during week 93, so it is
  // NILL, it is flagged for the §7.5 fine, and it is still 1,400 short. The 3,000 answers week 94.
  const ledger = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [paidInWeek94(3000)],
    config,
    now: PAY_DATE,
  });

  const week93 = weekOf(ledger, 93);
  assert.equal(week93.status, 'nill');
  assert.equal(week93.nillFineDue, true, '§7.5 fines the deadline, which was missed');
  assert.equal(week93.behind, true);
  assert.equal(week93.shortfall, 1400);
  assert.equal(weekOf(ledger, 94).shortfall, 0, 'the 3,000 covers the week it landed in');
  assert.equal(ledger.arrears, 1400);
  assert.equal(closedShort(ledger), ledger.arrears);
});

test('the week he missed is cleared only by paying that week', () => {
  // 1,400 dated in week 94 pays for week 94; week 93 is still 1,400 short.
  const nextWeek = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [paidInWeek94(1400)],
    config,
    now: PAY_DATE,
  });
  assert.equal(nextWeek.arrears, 1400);
  assert.equal(nextWeek.weeksBehind, 1);
  assert.equal(weekOf(nextWeek, 93).behind, true);
  assert.equal(weekOf(nextWeek, 94).behind, false);

  // The same 1,400 dated inside week 93 clears week 93 and leaves week 94 short — which is what
  // logging a catch-up payment against the week it belongs to does.
  const theMissedWeek = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [paidOn('2026-09-21', 1400)],
    config,
    now: PAY_DATE,
  });
  assert.equal(theMissedWeek.arrears, 1400);
  assert.equal(weekOf(theMissedWeek, 93).behind, false);
  assert.equal(weekOf(theMissedWeek, 94).behind, true);
});

test('a part payment leaves the rest of that week owing, and no more', () => {
  const ledger = computeMemberLedger({
    member: { openingBalance: 0 },
    contributions: [paidOn('2026-09-21', 1000)],
    config,
    now: PAY_DATE,
  });

  assert.equal(weekOf(ledger, 93).status, 'partial');
  assert.equal(weekOf(ledger, 93).shortfall, 400, "1,000 of the week's 1,400");
  assert.equal(weekOf(ledger, 94).shortfall, 1400, 'and week 94 is its own week');
  assert.equal(ledger.arrears, 1800);
  assert.equal(ledger.weeksBehind, 2);
  assert.equal(closedShort(ledger), ledger.arrears, 'the weeks add up to the arrears, to the shilling');
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
  assert.equal(weekOf(ledger, 93).shortfall, 1400);
  assert.equal(weekOf(ledger, 93).behind, true);
  assert.equal(closedShort(ledger), ledger.arrears);
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
