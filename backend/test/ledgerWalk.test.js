// The working behind a member's figure: opening balance, every payment, the tea each closed week
// takes, and the fines on their own line.
//
// The one thing every test here checks, one way or another, is that this walk arrives at the very
// figures utils/memberLedger arrives at. A walk that explained the balance with different arithmetic
// from the balance itself would be worse than no walk at all: it would be a second answer to a
// question the group only has one answer for.
//
// No database: both functions are pure over a settings config.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseEatDate, resolveConfig } = require('../src/utils/weekCycle');
const { computeMemberLedger } = require('../src/utils/memberLedger');
const { buildLedgerWalk, WEEKS_SHOWN } = require('../src/utils/ledgerWalk');

// Week 92 opens Fri 11 Sep 2026, so week 93 runs Fri 18 → Thu 24 Sep and week 94 opens on Fri 25
// Sep. Read on the Friday week 94 opens, exactly one week (93) has closed.
const config = resolveConfig({
  cycleStartWeek: 92,
  weeklyAmount: 1400,
  chaiAmount: 100,
  weekAnchorDate: parseEatDate('2026-09-11'),
});
const WEEK_93 = parseEatDate('2026-09-18');
const WEEK_94 = parseEatDate('2026-09-25');

let seq = 0;
const row = (over = {}) => ({
  _id: over._id || `c-${(seq += 1)}`,
  amount: 1400,
  grossAmount: null,
  fineDeducted: 0,
  date: WEEK_93,
  method: 'mobile',
  note: '',
  bucket: 'weekly',
  isGroupFund: false,
  ...over,
});

const walkFor = ({ contributions = [], fines = [], openingBalance = 0, now = WEEK_94 } = {}) => {
  const member = { openingBalance };
  return {
    walk: buildLedgerWalk({ member, contributions, fines, config, now }),
    ledger: computeMemberLedger({ member, contributions, config, now }),
  };
};

const moneyOf = (walk, kind) => walk.steps.filter((s) => s.kind === kind);

test('the walk adds up to the engine’s own figure, step by step', () => {
  const { walk, ledger } = walkFor({ openingBalance: 23000, contributions: [row()] });

  // 23,000 carried in + 1,400 paid − 100 tea for the one closed week.
  assert.equal(walk.closing.held, 24300);
  assert.equal(walk.closing.held, ledger.money);
  assert.equal(walk.balanced, true);

  // Every step carries both running figures, so a row can be read on its own.
  assert.equal(walk.steps[0].held, 23000);
  assert.equal(walk.steps[0].label, 'Carried in at week 92');
  const payment = moneyOf(walk, 'weekly')[0];
  assert.equal(payment.in, 1400);
  assert.equal(payment.weekNumber, 93);
  assert.equal(payment.held, 24400);
  // The tea lands on the week's own closing Thursday, after that week's collection.
  const tea = moneyOf(walk, 'teaWeek')[0];
  assert.equal(tea.weekNumber, 93);
  assert.equal(tea.out, 100);
  assert.equal(tea.held, 24300);
  assert.equal(walk.totals.moneyIn, 24400);
  assert.equal(walk.totals.paidIn, 1400);
  assert.equal(walk.totals.opening, 23000);
  assert.equal(walk.totals.moneyOut, 100);

  // And the walk reads down the page rather than in insert order.
  const stamps = walk.steps.map((s) => new Date(s.date).getTime());
  assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b));
});

test('a closed week nobody paid is never taken off the money — it is owed, and named at the foot', () => {
  const { walk, ledger } = walkFor({ openingBalance: 23000 });

  // Nothing was paid, so the only movement is the week's tea: 23,000 − 100.
  assert.equal(walk.closing.held, 22900);
  assert.equal(walk.closing.held, ledger.money);
  // The week that closed is the debt — reported, never a step, because subtracting it would read
  // as though it had been collected and spent.
  assert.equal(walk.closing.arrears, 1400);
  assert.equal(walk.closing.weeksBehind, 1);
  assert.equal(moneyOf(walk, 'weekly').length, 0);
  assert.equal(walk.balanced, true);
});

test('fines run on their own line and never move the money held', () => {
  const { walk } = walkFor({
    openingBalance: 23000,
    contributions: [row()],
    fines: [
      {
        _id: 'f1',
        amount: 400,
        remaining: 400,
        date: WEEK_93,
        type: 'Late arrival',
        reason: 'Clause 7.5 — 10 minutes late',
        settlements: [],
      },
    ],
  });

  const issued = moneyOf(walk, 'fineIssued')[0];
  assert.equal(issued.label, 'Fine — Late arrival');
  assert.equal(issued.detail, 'Clause 7.5 — 10 minutes late');
  assert.equal(issued.owedIn, 400);
  assert.equal(issued.in, 0);
  assert.equal(issued.out, 0);
  assert.equal(issued.effect, false);
  // The held figure at that point is untouched by it — the payment of the same day is all of it.
  assert.equal(issued.held, 24400);
  assert.equal(issued.owed, 400);
  // And the foot of the walk says what is still owed, matching the fines themselves.
  assert.equal(walk.closing.held, 24300);
  assert.equal(walk.closing.finesOwed, 400);
  assert.equal(walk.closing.finesRecorded, 400);
  assert.equal(walk.balanced, true);
});

test('a fine cleared out of a payment ends the owed column at zero', () => {
  const { walk, ledger } = walkFor({
    openingBalance: 23000,
    contributions: [
      row({ _id: 'c1', amount: 1000, grossAmount: 1400, fineDeducted: 400 }),
    ],
    fines: [
      {
        _id: 'f2',
        amount: 400,
        remaining: 0,
        date: WEEK_93,
        typeId: { name: 'Fines and Penalties' },
        settlements: [{ amount: 400, date: WEEK_93, contributionId: 'c1' }],
      },
    ],
  });

  const payment = moneyOf(walk, 'weekly')[0];
  // The ledger follows cash in, so the walk credits the whole 1,400 — and says where the 400 went,
  // because a member who handed over 1,400 has to find that fine named in the same row.
  assert.equal(payment.in, 1400);
  assert.match(payment.detail, /Ksh 400 of this cleared his fines\./);

  const settled = moneyOf(walk, 'fineSettled')[0];
  assert.equal(settled.owedOut, 400);
  assert.equal(settled.label, 'Fine cleared — Fines and Penalties');
  // Money before the fine it cleared, when both fall on the same day.
  const order = walk.steps.map((s) => s.kind);
  assert.ok(order.indexOf('weekly') < order.indexOf('fineSettled'));

  assert.equal(walk.closing.finesOwed, 0);
  assert.equal(walk.closing.finesRecorded, 0);
  assert.equal(walk.closing.money, ledger.money);
  assert.equal(walk.balanced, true);
});

test('the grouped fine shape the member screens send reads the same as the flat one', () => {
  const pending = [{ _id: 'p1', amount: 50, remaining: 50, date: WEEK_93, type: 'Late', settlements: [] }];
  const settled = [
    {
      _id: 's1',
      amount: 100,
      remaining: 0,
      date: WEEK_93,
      type: 'Absent',
      settlements: [{ amount: 100, date: WEEK_93 }],
    },
  ];
  const grouped = walkFor({ openingBalance: 1000, fines: { pending, settled, totalOwed: 50 } });
  const flat = walkFor({ openingBalance: 1000, fines: [...pending, ...settled] });

  assert.deepEqual(
    grouped.walk.steps.map((s) => [s.kind, s.owed]),
    flat.walk.steps.map((s) => [s.kind, s.owed])
  );
  assert.equal(grouped.walk.closing.finesOwed, 50);
  assert.equal(grouped.walk.balanced, true);
});

test('tea collected before the books opened comes off the money, and the walk still closes', () => {
  const beforeCycle = parseEatDate('2026-09-09');
  const { walk, ledger } = walkFor({
    openingBalance: 23000,
    contributions: [
      // The one-time week-91 collection: tea logged against a week the ledger only lists.
      row({ _id: 'week91-chai', amount: 100, date: beforeCycle, bucket: 'chai' }),
      row(),
    ],
  });

  const before = moneyOf(walk, 'chaiBefore')[0];
  assert.equal(before.out, 100);
  assert.equal(before.weekNumber, null);
  assert.equal(before.label, 'Tea — collected before these books opened');
  // Older than the opening week by date, and still read *after* it: the carried-in figure is the
  // baseline this money came off, so the walk opens with it whatever the dates say.
  assert.equal(walk.steps[0].kind, 'opening');
  assert.equal(walk.steps[0].held, 23000);
  assert.equal(walk.steps[1].kind, 'chaiBefore');
  assert.equal(walk.steps[1].held, 22900);
  assert.equal(walk.totals.teaOff, 200);
  assert.equal(walk.closing.held, 24200);
  assert.equal(walk.closing.held, ledger.money);
  assert.equal(walk.balanced, true);
});

test('a long cycle rolls the older tea weeks into one line and still adds up', () => {
  const now = parseEatDate('2027-02-05'); // 20 weeks on: 19 weeks have closed
  const { walk, ledger } = walkFor({ openingBalance: 0, now });

  const weeks = moneyOf(walk, 'teaWeek');
  assert.equal(walk.closing.weeksClosed, 20);
  // Twelve listed one by one, the eight older ones rolled into a single line.
  assert.equal(weeks.length, WEEKS_SHOWN + 1);
  const rolled = weeks.find((w) => /weeks \d+ to \d+/.test(w.label));
  assert.equal(rolled.out, 800);
  assert.equal(walk.totals.teaOff, 2000);
  assert.equal(walk.closing.held, -2000);
  assert.equal(walk.closing.held, ledger.money);
  assert.equal(walk.balanced, true);
});

test('money the weekly figure does not follow is listed, named, and moves nothing', () => {
  const { walk, ledger } = walkFor({
    openingBalance: 1000,
    contributions: [
      // A group fund nobody holds for him...
      row({ _id: 'g1', amount: 5000, bucket: 'other', isGroupFund: true, typeName: 'Group Objectives Fund' }),
      // ...tea paid at the desk, already inside the week's automatic deduction...
      row({ _id: 't1', amount: 100, bucket: 'chai', isGroupFund: true, typeName: 'Chai' }),
      // ...and his own money under a fund outside the weekly cycle.
      row({ _id: 'w1', amount: 2000, bucket: 'other', typeName: 'Welfare Contribution' }),
    ],
  });

  const groupFund = stepWithId(walk, 'contribution:g1');
  assert.equal(groupFund.effect, false);
  assert.equal(groupFund.in, 0);
  assert.equal(groupFund.label, 'Group Objectives Fund — group fund');

  const deskTea = stepWithId(walk, 'contribution:t1');
  assert.equal(deskTea.kind, 'chaiInCycle');
  assert.equal(deskTea.in, 0);
  assert.equal(deskTea.out, 0);

  const welfare = stepWithId(walk, 'contribution:w1');
  assert.equal(welfare.in, 0);
  assert.equal(welfare.label, 'Welfare Contribution — outside the weekly cycle');

  // The engine's held figure follows the weekly contribution and what he pays above it, so the
  // walk arrives at the same number it does — with the rows there for anyone to read.
  assert.equal(walk.closing.held, ledger.money);
  assert.equal(walk.closing.held, 900);
  assert.equal(walk.balanced, true);
});

test('an empty record is one line, and rows arriving out of order are read in date order', () => {
  const empty = walkFor().walk;
  assert.equal(empty.steps.length, 2); // the opening line and the week-93 tea
  assert.equal(empty.steps[0].kind, 'opening');
  assert.equal(empty.closing.held, -100);
  assert.equal(empty.balanced, true);

  // The treasurer's list arrives newest-first, the passbook oldest-first: the walk reads the same
  // either way, because it sorts.
  const rows = [row({ _id: 'a', date: parseEatDate('2026-09-14') }), row({ _id: 'b', date: parseEatDate('2026-09-21') })];
  const forwards = walkFor({ openingBalance: 100, contributions: rows }).walk;
  const backwards = walkFor({ openingBalance: 100, contributions: [...rows].reverse() }).walk;
  assert.deepEqual(
    forwards.steps.map((s) => [s.id, s.held]),
    backwards.steps.map((s) => [s.id, s.held])
  );
  assert.equal(forwards.steps[1].id, 'contribution:a');
});

test('a payment that cleared a fine says so — and the ledger’s own note is left to the ledger', () => {
  const { walk } = walkFor({
    openingBalance: 0,
    contributions: [
      // A plain payment: its M-Pesa note belongs to the row below, not repeated here.
      row({ _id: 'p1', amount: 1400, note: 'SK9X2Q1LMN Confirmed. Ksh1,400.00 sent on 17/9/26.' }),
      // And one that also cleared a fine, which the row alone does not say.
      row({ _id: 'p2', amount: 1000, grossAmount: 1400, fineDeducted: 400, date: parseEatDate('2026-09-21') }),
    ],
  });

  const payments = moneyOf(walk, 'weekly');
  assert.equal(payments[0].detail, null);
  assert.equal(payments[1].detail, 'Ksh 400 of this cleared his fines.');
});

test('a walk with nothing on it is still a walk, not a crash', () => {
  const walk = buildLedgerWalk({ member: null, config, now: WEEK_94 });
  assert.equal(walk.openingBalance, 0);
  assert.equal(walk.balanced, true);
  assert.equal(walk.steps[0].kind, 'opening');
  // Money fields are numbers, never NaN or a string: the screen renders them straight.
  assert.equal(typeof walk.closing.held, 'number');
  assert.equal(Number.isNaN(walk.closing.held), false);
});

function stepWithId(walk, id) {
  const found = walk.steps.find((s) => s.id === id);
  assert.ok(found, `expected a step with id ${id}`);
  return found;
}

