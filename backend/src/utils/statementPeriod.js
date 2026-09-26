// A statement for a period: "his 2026", "this quarter", "1 Mar – 30 Jun".
//
// The per-member statement has always covered everything: the figures to date, the last twelve
// months summarised, the schedule, every row. What it could not answer is the question members and
// the committee actually ask — *what happened in this period?* — and the reason it could not is the
// reason this module is careful: a ledger is not a transaction list.
//
// **Why filtering rows is not enough.** A member's money is not the sum of his contributions. It is
// `openingBalance + paid − tea`, where `tea` accrues automatically for every week that has *closed*
// since the books opened (utils/memberLedger). Slice the rows to March and add them up and the total
// will not be his balance in March, or in April, or anywhere — it will be a number that appears
// nowhere in the system and that nobody can reconcile. A statement whose figures do not add up is
// worse than no statement, because it will be argued with.
//
// The weeks that closed are *reported* rather than deducted: a closed week nobody paid leaves the
// held figure alone and shows as arrears (§7.5), which is the paper ledger's own reading of its
// total column. So `required` is printed on the statement as what was expected in the period, while
// the balance moves by what actually came in.
//
// The period's figures are not computed from the rows at all. They are **differences of two calls to
// the same engine** that produces the passbook:
//
//     opening (at the start of the period) = computeMemberLedger(…, now = from).money
//     closing (at the end of the period)   = computeMemberLedger(…, now = to).money
//
// which makes the reconciliation an identity rather than an assertion:
//
//     closing − opening  =  (paid − tea)  over the same window
//
// `balanced` checks exactly that and the renderers print it, so a statement that does not add up is
// visible on its own page instead of being discovered in an argument.
//
// The engine takes `now`, which is what makes an "as at" call possible at all — it was already
// there for `weeksElapsed`, and this module is why it is worth keeping.
const { computeMemberLedger } = require('./memberLedger');
const { EAT_OFFSET_MS, parseEatDate, toEatDateString } = require('./weekCycle');
const { toMoney } = require('./money');

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

// -----------------------------------------------------------------------------
// Resolving what was asked for
// -----------------------------------------------------------------------------

// The group's own calendar: an office that asks for "today" at 00:30 EAT means the day that has
// just started, not the one UTC is still in.
function eatToday(now = Date.now()) {
  return toEatDateString(new Date(now));
}

// A day's first millisecond, in EAT. The same arithmetic as weekCycle's startOfDay, one month up.
function startOfMonth(year, monthIndex) {
  return Date.UTC(year, monthIndex, 1) - EAT_OFFSET_MS;
}

// The last millisecond of the last day: the first millisecond of the next month, minus one.
function endOfMonth(year, monthIndex) {
  return startOfMonth(year, monthIndex + 1) - 1;
}

// A `yyyy-mm-dd` string, in EAT, checked rather than trusted.
//
// The regex alone is not enough: `2026-02-31` passes it and the parse rolls it into 3 March, which
// would silently give a statement for a period nobody asked for. Reading the parsed instant back as
// an EAT date string catches every such rollover, including 30 February and 31 April.
function readDay(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { error: `${label} must be a date like 2026-01-31` };
  }
  const parsed = parseEatDate(text);
  if (Number.isNaN(parsed.getTime()) || toEatDateString(parsed) !== text) {
    return { error: `${label} (${text}) is not a real date` };
  }
  return { ms: parsed.getTime(), text };
}

function labelFor(fromText, toText) {
  return fromText === toText ? fromText : `${fromText} to ${toText}`;
}

const RANGES = [
  'this-year',
  'last-year',
  'this-quarter',
  'last-quarter',
  'this-month',
  'last-month',
];

// Every shape the query can take, in one place, so the screen and the API cannot disagree about
// what "this quarter" means.
//
// Returns `null` when nothing was asked for — the whole book, exactly as the statement behaved
// before periods existed. That is what keeps every existing link and every old download working,
// and it is why the period is additive rather than a change to what a statement is.
//
// Returns `{ error }` rather than throwing, so a controller can answer 400 with the sentence
// instead of a stack trace.
function resolvePeriod(query = {}, { now = Date.now() } = {}) {
  const pick = (key) => String(query[key] == null ? '' : query[key]).trim();
  const range = pick('range').toLowerCase();
  const yearText = pick('year');
  const quarterText = pick('quarter');
  const monthText = pick('month');
  const fromText = pick('from');
  const toText = pick('to');

  if (!range && !yearText && !quarterText && !monthText && !fromText && !toText) return null;

  const today = eatToday(now);
  const todayMs = readDay(today, 'Today').ms;
  const [currentYear, currentMonth] = today.split('-').map(Number);

  let from;
  let to;
  let what = '';

  if (fromText || toText) {
    // --- an explicit pair of dates -------------------------------------------------
    if (!fromText) return { error: 'A custom period needs a "from" date' };
    const start = readDay(fromText, 'from');
    if (start.error) return { error: start.error };
    // Open-ended runs to today, which is the common case: "everything since March".
    const end = toText ? readDay(toText, 'to') : { ms: todayMs, text: today };
    if (end.error) return { error: end.error };
    if (end.ms < start.ms) return { error: '"to" is before "from" — that period is empty' };
    from = start;
    to = end;
    what = 'the dates chosen';
  } else if (yearText || quarterText || monthText || RANGES.includes(range)) {
    // --- a year, a quarter, a month, or a named range ------------------------------
    let year = currentYear;
    if (yearText) {
      if (!/^\d{4}$/.test(yearText)) return { error: 'year must be four digits, like 2026' };
      year = Number(yearText);
    }

    let months;
    if (quarterText) {
      const quarter = Number(quarterText);
      if (![1, 2, 3, 4].includes(quarter)) return { error: 'quarter must be 1, 2, 3 or 4' };
      months = [0, 1, 2].map((offset) => (quarter - 1) * 3 + offset);
      what = `Q${quarter} ${year}`;
    } else if (monthText) {
      const month = Number(monthText);
      if (!(month >= 1 && month <= 12)) return { error: 'month must be 1 to 12' };
      months = [month - 1];
      what = `${MONTH_NAMES[month - 1]} ${year}`;
    } else if (range === 'this-quarter' || range === 'last-quarter') {
      let quarter = Math.floor((currentMonth - 1) / 3) + 1;
      if (range === 'last-quarter') quarter -= 1;
      // "Last quarter" asked for in January is the last quarter of the year before — the year
      // rolling over is exactly the case a hand-written date would get wrong.
      if (quarter === 0) {
        quarter = 4;
        year -= 1;
      }
      months = [0, 1, 2].map((offset) => (quarter - 1) * 3 + offset);
      what = `Q${quarter} ${year}`;
    } else if (range === 'this-month' || range === 'last-month') {
      let monthIndex = currentMonth - 1;
      if (range === 'last-month') {
        monthIndex -= 1;
        if (monthIndex < 0) {
          monthIndex = 11;
          year -= 1;
        }
      }
      months = [monthIndex];
      what = `${MONTH_NAMES[monthIndex]} ${year}`;
    } else {
      // this-year, last-year, or a bare ?year= — all twelve months.
      if (range === 'last-year') year -= 1;
      months = Array.from({ length: 12 }, (_, index) => index);
      what = `the year ${year}`;
    }

    if (year < MIN_YEAR || year > MAX_YEAR) {
      return { error: `year must be between ${MIN_YEAR} and ${MAX_YEAR}` };
    }

    const firstMs = startOfMonth(year, months[0]);
    const lastMs = endOfMonth(year, months[months.length - 1]);
    from = { ms: firstMs, text: toEatDateString(new Date(firstMs)) };
    to = { ms: lastMs, text: toEatDateString(new Date(lastMs)) };
  } else {
    return {
      error: `"${range}" is not a period. Try ${RANGES.join(', ')}, or a from/to pair`,
    };
  }

  // A period that has not finished cannot have a closing position: the engine would count weeks as
  // closed that have not closed, and the statement would read as though the last fortnight had
  // already happened. Clamped, and said out loud rather than quietly — the note is printed.
  let note = '';
  if (to.ms > todayMs) {
    to = { ms: todayMs, text: today };
    note = `This period had not finished when the statement was printed, so it runs to ${today} (${what}).`;
  }

  return {
    from: from.ms,
    to: to.ms,
    fromDate: from.text,
    toDate: to.text,
    label: labelFor(from.text, to.text),
    what,
    note,
    // A period ending today is "open": nothing after it exists, and the closing figure is today's,
    // which is the same number the passbook shows.
    openEnded: to.text === today,
  };
}

// -----------------------------------------------------------------------------
// The figures for the period
// -----------------------------------------------------------------------------

// `all` is every contribution, annotated for the engine exactly as the controller annotates them
// (bucket + isGroupFund), because both engine calls must see what the passbook's own call sees —
// including the tea rows a member's copy does not list, since those are what the tea deduction is
// reconciled against.
//
// `visible` is what the reader is entitled to see listed, and is used only for the tables.
function computePeriodBlock({ member, config, all = [], visible = [], period, now = Date.now() }) {
  const at = (contribution) => new Date(contribution.date).getTime();

  // The two positions. `period.from - 1` for the opening call because the period includes its first
  // day: money paid on 1 January belongs to the January statement, not to the balance carried into
  // it.
  const opening = computeMemberLedger({
    member,
    contributions: all.filter((c) => at(c) <= period.from - 1),
    config,
    now: period.from,
  });
  const closing = computeMemberLedger({
    member,
    contributions: all.filter((c) => at(c) <= period.to),
    config,
    now: period.to,
  });

  const openingMoney = toMoney(opening.money);
  const closingMoney = toMoney(closing.money);
  const paidIn = toMoney(closing.paid - opening.paid);
  const required = toMoney(closing.required - opening.required);
  const tea = toMoney(closing.chai.due - opening.chai.due);
  // Arrears carried through the period, on the same footing as `required`: reported beside the
  // balance rather than taken out of it, so a statement whose member missed a week shows the week
  // and the money held at both ends rather than silently reading as though it had been paid.
  const arrears = toMoney(closing.arrears - opening.arrears);
  const movement = toMoney(closingMoney - openingMoney);

  // The identity, checked rather than assumed. Both sides go through the same rounding helper, so
  // this is a real check and not a tolerance that would hide a bug. `required` is deliberately not
  // in it: a closed week nobody paid is arrears, not a movement of the money he holds.
  const accountedFor = toMoney(paidIn - tea);

  const rows = visible.filter((contribution) => at(contribution) >= period.from && at(contribution) <= period.to);

  // By type, over the period only — the same shape the whole-book statement uses, so the two
  // sections read alike. Group funds (tea) are excluded from a member's own shares for the reason
  // the whole-book breakdown excludes them: that money was never his.
  const typeTotals = new Map();
  for (const contribution of rows) {
    if (contribution.isGroupFund) continue;
    const key = contribution.type || 'Other';
    typeTotals.set(key, (typeTotals.get(key) || 0) + (Number(contribution.amount) || 0));
  }
  const periodPaid = [...typeTotals.values()].reduce((sum, value) => sum + value, 0);

  // Month by month, only the months the period touches, so a year statement lists twelve and a
  // March statement lists one.
  const byMonth = new Map();
  for (const contribution of rows) {
    if (contribution.isGroupFund) continue;
    const shifted = new Date(at(contribution) + EAT_OFFSET_MS);
    const key = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, (byMonth.get(key) || 0) + (Number(contribution.amount) || 0));
  }

  const months = [];
  const cursor = new Date(period.from + EAT_OFFSET_MS);
  const last = new Date(period.to + EAT_OFFSET_MS);
  while (
    cursor.getUTCFullYear() < last.getUTCFullYear() ||
    (cursor.getUTCFullYear() === last.getUTCFullYear() && cursor.getUTCMonth() <= last.getUTCMonth())
  ) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    months.push({
      month: key,
      label: `${MONTH_NAMES[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`,
      amount: byMonth.get(key) || 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return {
    from: period.fromDate,
    to: period.toDate,
    label: period.label,
    what: period.what,
    note: period.note,
    openEnded: period.openEnded,
    // What he held at each end, and what moved it: what came in, what went out as tea, and the
    // weeks that closed — which are reported rather than deducted, so a NILL week shows in `arrears`
    // and leaves `closing` alone.
    opening: openingMoney,
    closing: closingMoney,
    paidIn,
    required,
    arrears,
    tea,
    movement,
    accountedFor,
    // Printed on the statement. When this is false the statement says so rather than being handed
    // over as though it balanced.
    balanced: accountedFor === movement,
    weeksClosed: closing.chai.weeks - opening.chai.weeks,
    contributionsCount: rows.length,
    monthly: months,
    monthlyTotal: months.reduce((sum, month) => sum + month.amount, 0),
    byType: [...typeTotals.entries()]
      .map(([type, contributed]) => ({
        type,
        contributed: toMoney(contributed),
        share: periodPaid > 0 ? Number(((contributed / periodPaid) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.contributed - a.contributed),
    contributions: rows,
    // The position to date, carried alongside so a period statement can still say what he holds
    // now — the question "and what does he have today?" always follows the period one.
    asAtToday: toMoney(computeMemberLedger({ member, contributions: all, config, now }).money),
  };
}

module.exports = { resolvePeriod, computePeriodBlock, eatToday, labelFor, startOfMonth, endOfMonth };

