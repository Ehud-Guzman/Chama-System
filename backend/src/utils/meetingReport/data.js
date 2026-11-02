// The meeting report, part: data. utils/meetingReport.js is the index everything else requires.

const { toMoney } = require('../money');
const { coveredByBalance } = require('../reminderLimit');
const { mapExpense } = require('../expenseReport');
const { CHAMA_NAME } = require('../../data/branding');
const { money } = require('./format');

// The page the office hands round at a meeting.
//
// Every figure on the reports screen already exists somewhere — the week's collection on the
// summary, who owes a fine on the fines tab, the spending on its own screen — but each one lives
// behind its own tab, and a meeting wants them on paper, together, each with the total that closes
// it. This builds that document from the same functions those screens read (computeMoneyPosition,
// computeThisWeek, computeFinesReport, the expense rows, computeMemberDues), so a number printed here
// cannot differ from the number on the screen it came from.
//
// The builder is pure — everything it needs arrives as an argument — so the arithmetic can be
// checked without a database. The controller gathers the data; this file decides what it means.

// The sections, in the order they are printed.
const SECTIONS = [
  { key: 'position', label: 'Where the money stands' },
  { key: 'week', label: "This week's collection" },
  { key: 'debts', label: 'Members below the line (debts)' },
  { key: 'extra', label: 'Members above the line (extra)' },
  { key: 'fines', label: 'Fines' },
  { key: 'expenses', label: 'Expenses' },
];

const SECTION_KEYS = SECTIONS.map((s) => s.key);

// The roles that may see itemised spending — the same three the expenses routes allow. The expenses
// section lists vouchers, which the reports roles beyond these (the secretary) never see elsewhere.
const EXPENSE_ROLES = ['super_admin', 'admin', 'treasurer'];

// Which spending the expenses section lists. Relative to now, in the group's own calendar.
const EXPENSE_PERIODS = {
  week: 'This week',
  month: 'This month',
  all: 'Everything on record',
};

// Reads the `sections` query. Omitted means everything; a list names what to print. An unknown name
// is refused rather than ignored: a misspelt section that silently vanishes from a printed page is
// a page somebody trusts and should not.
function parseSections(raw) {
  if (raw === undefined || raw === null) return { sections: [...SECTION_KEYS] };
  const asked = [].concat(raw)
    .join(',')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (asked.length === 0) return { error: 'Pick at least one section to print' };
  const unknown = asked.filter((s) => !SECTION_KEYS.includes(s));
  if (unknown.length > 0) {
    return { error: `Unknown section: ${unknown.join(', ')}. Choose from ${SECTION_KEYS.join(', ')}` };
  }
  // Printed in the page's own order, whatever order the request listed them in, and once each.
  return { sections: SECTION_KEYS.filter((key) => asked.includes(key)) };
}

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// The dates an expenses section covers, as an inclusive range (or none, for everything).
// `weekStart`/`weekEnd` are the week the group is in; the month is the group's own calendar month
// (Kenya, UTC+3), as every other report groups it.
function expensePeriod(key, { weekStart, weekEnd, now = Date.now() }) {
  if (key === 'all') return { key, label: 'Everything on record', from: null, to: null };
  if (key === 'month') {
    const shifted = new Date(new Date(now).getTime() + EAT_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    return {
      key,
      label: `${MONTH_FULL[month]} ${year}`,
      from: new Date(Date.UTC(year, month, 1) - EAT_OFFSET_MS),
      to: new Date(Date.UTC(year, month + 1, 1) - EAT_OFFSET_MS - 1),
    };
  }
  return { key: 'week', label: 'This week', from: new Date(weekStart), to: new Date(weekEnd) };
}

// Who is below the group's money line and who is at or above it, with how far in each direction.
//
// "Holds" is the money the group is keeping for the member — carried in, plus paid in, less the tea
// and the fines that came off it (utils/memberLedger `money`) — and the line is the figure the group
// itself measures that against (utils/reminderLimit). At the line counts as above it, exactly as the
// reminders decide who is left alone. A line of 0 is the group switching the rule off, and then
// there is nothing to measure against: both lists are empty and the page says why.
function splitByLine(members, line) {
  const target = toMoney(line);
  if (!(target > 0)) return { off: true, line: 0, below: [], above: [] };

  const below = [];
  const above = [];
  for (const member of members) {
    const held = toMoney(member.held);
    if (coveredByBalance(held, target)) {
      above.push({ ...member, held, extra: toMoney(held - target) });
    } else {
      below.push({ ...member, held, short: toMoney(target - held) });
    }
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  // The biggest gap first: it is the line a meeting reads down.
  below.sort((a, b) => b.short - a.short || byName(a, b));
  above.sort((a, b) => b.extra - a.extra || byName(a, b));
  return { off: false, line: target, below, above };
}

const sum = (rows, pick) => toMoney(rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0));

function buildPosition(position, finesCollected) {
  const gf = position.groupFund || {};
  const funds = (position.funds || [])
    .map((f) => ({
      name: f.name,
      in: toMoney((Number(f.carriedIn) || 0) + (Number(f.collected) || 0) + (Number(f.derived) || 0)),
      out: Number(f.spent) || 0,
      holds: Number(f.balance) || 0,
      isRecoverable: Boolean(f.isRecoverable),
    }))
    .sort((a, b) => b.holds - a.holds);

  return {
    moneyIn: Number(position.totalContributed) || 0,
    carriedIn: Number(position.carriedIn?.total) || 0,
    paidIn: Number(position.collected) || 0,
    spent: Number(position.totalExpenses) || 0,
    spentFromFunds: Number(position.spentFromFunds) || 0,
    spentFromGroupTotal: Number(position.spentFromGroupTotal) || 0,
    held: Number(position.netBalance) || 0,
    finesCollected: Number(finesCollected) || 0,
    funds,
    // The funds added up, with the arithmetic a reader can check: in, less out, is what they hold.
    fundTotals: {
      in: Number(gf.in) || 0,
      // Everything that has left them — gone for good, and out on loan — so the row adds up.
      out: toMoney((Number(gf.spent) || 0) + (Number(gf.onLoan) || 0)),
      onLoan: Number(gf.onLoan) || 0,
      holds: Number(gf.holds) || 0,
    },
  };
}

function buildExpenses(expenses, period) {
  const rows = expenses
    .map((expense) => ({
      ...mapExpense(expense),
      // Money lent out of a fund is still owed back, so it is listed and totalled apart from what
      // has been spent — the rule the spending report and the group total already follow.
      recoverable: Boolean(expense.typeId && expense.typeId.isRecoverable),
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const byFundMap = new Map();
  for (const row of rows) {
    const fund = byFundMap.get(row.fund) || { name: row.fund, count: 0, amount: 0, recoverable: row.recoverable };
    fund.count += 1;
    fund.amount = toMoney(fund.amount + row.amount);
    byFundMap.set(row.fund, fund);
  }

  const total = sum(rows, (r) => r.amount);
  const owedBack = sum(rows.filter((r) => r.recoverable), (r) => r.amount);
  return {
    period,
    rows,
    byFund: [...byFundMap.values()].sort((a, b) => b.amount - a.amount),
    totals: {
      count: rows.length,
      total,
      owedBack,
      // What has actually been spent: everything listed, less the loans and advances.
      spent: toMoney(total - owedBack),
    },
  };
}

function buildFines(fines) {
  const owing = (fines.byMember || []).filter((m) => m.outstanding > 0);
  return {
    totals: fines.totals,
    byType: fines.byType || [],
    byMember: owing,
    // The list is cut at a payload limit; a page that quietly stopped at the biggest N would read as
    // everybody who owes, so it says so.
    truncated: Boolean(fines.byMemberTruncated),
    limit: fines.byMemberLimit || owing.length,
    owedByListed: sum(owing, (m) => m.outstanding),
    finesListed: sum(owing, (m) => m.fines),
  };
}

// Everything the PDF prints, with the totals worked out once. Only the sections asked for are built:
// a page that was asked for the debts alone should not carry (or cost) the spending.
function buildMeetingReport({
  chamaName = '',
  preparedBy = '',
  generatedAt = new Date(),
  sections = SECTION_KEYS,
  week = null,
  line = 0,
  members = [],
  position = null,
  finesCollected = 0,
  fines = null,
  expenses = [],
  period = null,
}) {
  const wanted = SECTION_KEYS.filter((key) => sections.includes(key));
  const has = (key) => wanted.includes(key);

  const split = has('debts') || has('extra') ? splitByLine(members, line) : null;

  const debts = has('debts')
    ? {
        off: split.off,
        line: split.line,
        rows: split.below,
        totals: {
          count: split.below.length,
          total: sum(split.below, (r) => r.short),
          members: members.length,
          // Below the line with no closed week unpaid: this week's contribution not yet in, or fines
          // paid out of his holdings. Counted so the page can say so rather than leave it unexplained.
          noUnpaidWeek: split.below.filter((r) => !r.weeksUnpaid).length,
        },
      }
    : null;
  const extra = has('extra')
    ? {
        off: split.off,
        line: split.line,
        rows: split.above,
        totals: {
          count: split.above.length,
          total: sum(split.above, (r) => r.extra),
          members: members.length,
        },
      }
    : null;

  const built = {
    chamaName: chamaName || CHAMA_NAME,
    preparedBy,
    generatedAt,
    sections: wanted,
    week: week
      ? { number: week.weekNumber, startDate: week.startDate, endDate: week.endDate }
      : null,
    position: has('position') && position ? buildPosition(position, finesCollected) : null,
    thisWeek: has('week') && week ? week : null,
    debts,
    extra,
    fines: has('fines') && fines ? buildFines(fines) : null,
    expenses: has('expenses') ? buildExpenses(expenses, period || { key: 'all', label: 'Everything on record' }) : null,
  };

  // The page's first block: one line per section, the figure that section's total closes on. A
  // reader who reads nothing else has still read the position.
  const glance = [];
  if (built.position) {
    glance.push(['Held by the group now', money(built.position.held)]);
    glance.push(['What the group funds hold', money(built.position.fundTotals.holds)]);
  }
  if (built.thisWeek) {
    glance.push([
      `Week ${built.thisWeek.weekNumber} collected`,
      `${money(built.thisWeek.paid)} of ${money(built.thisWeek.expected)}`,
    ]);
  }
  if (built.debts) {
    glance.push([
      'Below the money line',
      built.debts.off
        ? 'Money line is switched off'
        : `${built.debts.totals.count} of ${built.debts.totals.members} members, ${money(built.debts.totals.total)} short`,
    ]);
  }
  if (built.extra) {
    glance.push([
      'Above the money line',
      built.extra.off
        ? 'Money line is switched off'
        : `${built.extra.totals.count} of ${built.extra.totals.members} members, ${money(built.extra.totals.total)} over`,
    ]);
  }
  if (built.fines) {
    glance.push([
      'Fines still owed',
      `${money(built.fines.totals.outstanding)} by ${built.fines.totals.membersOwing} member${
        built.fines.totals.membersOwing === 1 ? '' : 's'
      }`,
    ]);
  }
  if (built.expenses) {
    glance.push([
      `Spent (${built.expenses.period.label})`,
      `${money(built.expenses.totals.spent)} in ${built.expenses.totals.count} entr${
        built.expenses.totals.count === 1 ? 'y' : 'ies'
      }`,
    ]);
  }
  built.glance = glance;
  return built;
}

module.exports = {
  EXPENSE_PERIODS,
  EXPENSE_ROLES,
  SECTIONS,
  SECTION_KEYS,
  buildMeetingReport,
  expensePeriod,
  parseSections,
  splitByLine,
};
