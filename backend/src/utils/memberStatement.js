const PDFDocument = require('pdfkit');
const { sendWorkbook } = require('./xlsxExport');
const { toEatDateString } = require('./weekCycle');

// The member's statement, in both of the formats it is asked for: a PDF to read on
// a phone, and a workbook the office keeps. Both are built from the same profile
// (see buildPublicProfile), so a member's own download and the office's copy can
// never tell two different stories — the one difference between them is whether
// the Tea Fund is named.
//
// Pledges are gone from this system, so nothing here asks what a member promised:
// a statement is a record of what actually moved.
//
// A statement may cover a **period** ("his 2026", "this quarter"). When it does, the
// profile carries a `period` block computed by utils/statementPeriod, and this file
// presents it instead of the whole-book view: the same sections, over the months and rows
// that fall inside. The block's figures come from the ledger engine, not from adding up
// the rows, so the statement's arithmetic reconciles — and where the period is still
// running, the block says so rather than printing a closing balance that has not happened.

const numberFmt = new Intl.NumberFormat('en-KE');
function money(amount) {
  return `Ksh ${numberFmt.format(Number(amount) || 0)}`;
}
function shortDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_SHOWN = 12;
const WEEKS_SHOWN = 12;

// The group keeps its calendar in Kenya (UTC+3), so a payment keyed in after
// midnight belongs to the month the office would file it under, not the one UTC
// would put it in.
function monthKeyOf(date) {
  const shifted = new Date(new Date(date).getTime() + 3 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthLabelOf(key) {
  const [year, month] = key.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}
function lastMonthKeys(count = MONTHS_SHOWN) {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const keys = [];
  for (let back = count - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}


const STATUS_LABELS = {
  paid: 'Paid',
  partial: 'Part paid',
  unpaid: 'Not paid',
  baseline: 'Opening week',
};

// Everything both renderers need, worked out once so the PDF and the workbook can
// never disagree about a figure.
function buildStatement(profile) {
  const contributions = profile.contributions || [];
  const ledger = profile.ledger || null;
  const fines = profile.fines || { pending: [], settled: [], totalOwed: 0 };

  // The period, when one was asked for (utils/statementPeriod). Everything below reads from the
  // block rather than re-filtering by date here, so the tables and the figures cannot disagree
  // about what is in scope — and the rows a reader counts are the rows the engine added up.
  const period = profile.period || null;

  // Scope test for the sections the block does not carry: the weekly schedule and the fines.
  // Compared as EAT calendar dates so a payment logged at 00:30 belongs to the day the office
  // would file it under.
  const withinPeriod = (value) => {
    if (!period) return true;
    if (!value) return false;
    const day = toEatDateString(new Date(value));
    return day >= period.from && day <= period.to;
  };

  // The rows in scope: the period's own, or every one of them.
  const rows = period ? period.contributions : contributions;

  // Month by month, his own money only: a group fund he paid into is not his
  // contribution, and the passbook already keeps it out of his total.
  const byMonth = new Map();
  for (const c of rows) {
    if (c.isGroupFund) continue;
    const key = monthKeyOf(c.date);
    byMonth.set(key, (byMonth.get(key) || 0) + (Number(c.amount) || 0));
  }
  // A period lists exactly the months it touches — twelve for a year, one for March — with the
  // empty ones shown as zero rather than dropped, because a gap in a statement reads as a
  // printing error. Without a period it is the trailing twelve months, as it always was.
  const monthly = period
    ? period.monthly
    : lastMonthKeys().map((key) => ({
        month: key,
        label: monthLabelOf(key),
        amount: byMonth.get(key) || 0,
      }));


  // The weekly schedule, newest week first — the week just gone is the one a
  // member looks for. The weeks before the cycle opened (1..91) are summarised
  // rather than listed: ninety lines of "carried forward" is a wall, not a
  // statement, and that money is inside the carried-forward figure anyway.
  //
  // For a period statement the weeks are narrowed to the ones inside it, and the
  // "before the cycle — carried forward" summary is dropped: its money is not part of the
  // period, and printing it there would invite it into the arithmetic.
  const weekly = (profile.weeklySchedules || []).map((schedule) => ({
    typeName: schedule.typeName,
    weeklyAmount: schedule.weeklyAmount,
    weeks: [...(schedule.weeks || [])]
      .filter((w) => withinPeriod(w.endDate || w.startDate))
      .reverse()
      .map((w) => ({
        weekNumber: w.weekNumber,
        startDate: w.startDate,
        endDate: w.endDate,
        expected: w.expected,
        paid: w.paid,
        status: STATUS_LABELS[w.status] || w.status || '',
        isBaseline: Boolean(w.isBaseline),
        isCurrent: Boolean(w.isCurrent),
      })),
    historyCount: period ? 0 : (schedule.history || []).length,
    historyPaid: period
      ? 0
      : (schedule.history || []).reduce((sum, w) => sum + (Number(w.paid) || 0), 0),
  }));

  // Fines in scope, and the totals recomputed over what is left rather than carried over from the
  // whole book — a period statement that still claimed a fine from outside it would be wrong.
  const pendingFines = period ? fines.pending.filter((f) => withinPeriod(f.date)) : fines.pending;
  const settledFines = period ? fines.settled.filter((f) => withinPeriod(f.date)) : fines.settled;
  const finesOwedInScope = pendingFines.reduce((sum, f) => sum + (Number(f.remaining) || 0), 0);

  const figures = period
    ? [
        // The period's own arithmetic, in the order it is checked: what he held, what came in, what
        // the group took out (the tea), and what he held at the end. The weeks that closed are
        // printed here as what was *expected* — a closed week nobody paid is arrears below, and the
        // one thing that moves the money held is the payment itself.
        { label: `Money at the start (${period.from})`, value: period.opening, strong: true },
        { label: 'Paid in during the period', value: period.paidIn },
        { label: 'Tea deducted (Group fund)', value: period.tea },
        {
          label: `Money at the end (${period.to})`,
          value: period.closing,
          strong: true,
        },
        {
          // Not a deduction: what the weeks expected of him, reported so a reader can see the two
          // figures side by side. The arrears line names what of it is still unpaid.
          label: `Weeks that closed (${period.weeksClosed}) — expected, not taken off the money held`,
          value: period.required,
        },
        {
          label: 'Owed at the end (closed weeks still unpaid)',
          value: period.arrears,
          alert: period.arrears > 0,
        },
        { label: 'Contributions in the period', value: period.contributionsCount },
        // The question that always follows the period one, so it is answered on the same page.
        { label: 'Money held today', value: period.asAtToday },
        { label: 'Fines owed now', value: finesOwedInScope, alert: finesOwedInScope > 0 },
        { label: 'Member since', value: shortDate(profile.joinDate) },
        { label: 'Statement generated', value: shortDate(new Date()) },
      ]
    : [
        {
          label: 'Money held by member',
          value: ledger ? ledger.money : profile.totalContributed || 0,
          strong: true,
        },
        {
          label: `Carried in at week ${ledger ? ledger.cycleStartWeek : '—'}`,
          value: ledger ? ledger.openingBalance : 0,
        },
        {
          label: 'Paid in since the books opened',
          value: ledger ? ledger.paid : profile.totalContributed || 0,
        },
        {
          // One expectation figure for a member's own copy: the weekly contribution and
          // what the Group charges alongside it. The office's copy breaks the tea out.
          //
          // Worded as an expectation rather than a deduction because that is what it is: the money
          // held above is what he actually handed over, and a week he has not paid is the `Owed`
          // line below rather than something already taken off him.
          label: 'Expected so far (the weeks that have closed) — not taken off the money held',
          value: ledger
            ? profile.teaFundIncluded
              ? ledger.required
              : ledger.required + ledger.tea
            : 0,
        },
        ...(ledger && profile.teaFundIncluded
          ? [{ label: 'Tea (deducted automatically, Group fund)', value: ledger.tea }]
          : []),
        {
          label: 'Owed (closed weeks still unpaid)',
          value: ledger ? ledger.arrears : 0,
          alert: Boolean(ledger && ledger.arrears > 0),
        },
        { label: 'Extra saved (paid more than was due)', value: ledger ? ledger.credit : 0 },
        { label: 'Contributions logged', value: profile.contributionsCount || contributions.length },
        { label: 'Paid in the rows below', value: profile.totalContributed || 0 },
        {
          label: 'Fines owed now (kept out of the figures above)',
          value: fines.totalOwed || 0,
          alert: Number(fines.totalOwed) > 0,
        },
        { label: 'Fines cleared', value: profile.finesSettledCount || 0 },
        { label: 'Member since', value: shortDate(profile.joinDate) },
        { label: 'Statement generated', value: shortDate(new Date()) },
      ];


  return {
    member: {
      name: profile.name || '',
      regNumber: profile.regNumber || '',
      phoneMasked: profile.phoneMasked || '',
    },
    // The period, when there is one, so the renderers can print what the statement covers and
    // whether it added up. `null` for a whole-book statement, which is every statement before this
    // existed and still the default.
    period,
    figures,
    byType: period ? period.byType : profile.byType || [],
    monthly,
    monthlyTotal: monthly.reduce((sum, m) => sum + m.amount, 0),
    weekly,
    weeksShown: WEEKS_SHOWN,
    fines: {
      pending: pendingFines || [],
      settled: settledFines || [],
      totalOwed: finesOwedInScope || 0,
      settledTotal: (settledFines || []).reduce((sum, f) => sum + (Number(f.amount) || 0), 0),
    },
    // The rows in scope — the period's, or every row there is.
    contributions: rows,
    teaFundIncluded: Boolean(profile.teaFundIncluded),
  };
}

// The arithmetic, as a block the renderers print under the figures.
//
// The sum, as an equation, for the one block somebody checks by hand across a table.
//
// It exists as its own array rather than three more entries in `figures` because it is not a list
// of facts about the member — it is the sum that proves the figures above it belong together, and it
// has to read as an equation to do its job. `balanced` is computed, never assumed
// (utils/statementPeriod): a statement that does not add up says so on its own page rather than
// being handed over as though it did.
//
// The weeks that closed are named *below* the total rather than subtracted inside it: a closed week
// nobody paid is money that never came in, so taking it off the balance would read as though it had
// been collected and spent (see utils/memberLedger). What it is, is owed — and the line says so.
function reconciliationLines(period) {
  return [
    { label: `Money at the start (${period.from})`, value: period.opening },
    { label: 'Plus what he paid in', value: period.paidIn, sign: '+' },
    { label: 'Less tea (Group fund)', value: period.tea, sign: '−' },
    { label: `Money at the end (${period.to})`, value: period.closing, sign: '=' },
    {
      label: `Of which owed: weeks that closed, still unpaid (${period.weeksClosed} closed)`,
      value: period.arrears,
    },
  ];
}


// The workbook: one sheet per question the office asks. Summary first, then what
// he paid by type, month by month, the weekly schedule, his fines, and finally
// every row behind the figures.
function memberStatementSheets(profile, chamaName) {
  const statement = buildStatement(profile);
  const period = statement.period;

  // "Paid in the rows below" is the whole-book label. A period statement's equivalent is the
  // block's own `paidIn`, and the shares have already been worked out over the period by
  // utils/statementPeriod — so they cannot disagree with the figure they are shares *of*.
  const paidInRows = period
    ? period.paidIn
    : Number((statement.figures.find((f) => f.label === 'Paid in the rows below') || {}).value || 0);

  const summaryRows = [
    { Field: 'Chama', Value: chamaName || '' },
    { Field: 'Member', Value: statement.member.name },
    { Field: 'Registration number', Value: statement.member.regNumber },
    // The scope of the statement, stated first. A figure with no stated scope is how two people end
    // up arguing about the same statement (utils/aboutSheet makes the same point about exports).
    //
    // The arithmetic itself is not repeated here: `statement.figures` already reads as the equation
    // — money at the start, paid in, the tea, money at the end, with the weeks that closed and what
    // is owed named under it — and printing the start and end twice on one sheet is how a reader
    // starts wondering which one is the real figure. The PDF prints them again with + and − signs,
    // where there is room for it to read as a sum rather than a list.
    ...(period
      ? [
          { Field: 'Period covered', Value: period.label },
          { Field: 'Period is', Value: period.openEnded ? 'still running' : 'complete' },
          ...(period.note ? [{ Field: 'Note', Value: period.note }] : []),
          { Field: 'The arithmetic adds up', Value: period.balanced ? 'Yes' : 'NO — see the note' },
        ]
      : []),
    ...statement.figures.map((f) => ({ Field: f.label, Value: f.value })),
  ];

  const byTypeRows = statement.byType.map((b) => ({
    'Contribution type': b.type || '',
    Contributed: b.contributed || 0,
    'Share of the rows (%)':
      b.share != null
        ? b.share
        : paidInRows > 0
          ? Number((((b.contributed || 0) / paidInRows) * 100).toFixed(1))
          : 0,
  }));

  byTypeRows.push({
    'Contribution type': 'TOTAL',
    Contributed: statement.byType.reduce((sum, b) => sum + (Number(b.contributed) || 0), 0),
    'Share of the rows (%)': 100,
  });

  const monthlyRows = statement.monthly.map((m) => ({
    Month: m.label,
    'His own contributions': m.amount,
  }));
  monthlyRows.push({
    // The label names the scope, because "TOTAL" over a period is a different number from "TOTAL"
    // over twelve months and the sheet looks the same either way.
    Month: period
      ? `TOTAL (${statement.monthly.length} month${statement.monthly.length === 1 ? '' : 's'} in ${period.label})`
      : `TOTAL (last ${MONTHS_SHOWN} months)`,
    'His own contributions': statement.monthlyTotal,
  });

  const weeklyRows = [];
  for (const schedule of statement.weekly) {
    for (const week of schedule.weeks) {
      weeklyRows.push({
        Fund: schedule.typeName || '',
        Week: week.weekNumber,
        From: week.startDate ? new Date(week.startDate).toISOString().slice(0, 10) : '',
        To: week.endDate ? new Date(week.endDate).toISOString().slice(0, 10) : '',
        'Weekly amount': schedule.weeklyAmount || 0,
        Expected: week.expected || 0,
        Paid: week.paid || 0,
        Status: week.status,
      });
    }
    if (schedule.historyCount > 0) {
      // Weeks 1..91 in a single line: their money is inside the carried-forward
      // figure, so listing each of them again would count it twice.
      weeklyRows.push({
        Fund: schedule.typeName || '',
        Week: `1–${schedule.historyCount}`,
        From: '',
        To: '',
        'Weekly amount': schedule.weeklyAmount || 0,
        Expected: 0,
        Paid: schedule.historyPaid,
        Status: 'Before the cycle — carried forward',
      });
    }
  }
  weeklyRows.push({
    Fund: 'TOTAL ON THE SCHEDULES',
    Week: '',
    From: '',
    To: '',
    'Weekly amount': statement.weekly.reduce((sum, s) => sum + (Number(s.weeklyAmount) || 0), 0),
    Expected: statement.weekly.reduce(
      (sum, s) => sum + s.weeks.reduce((inner, w) => inner + (Number(w.expected) || 0), 0),
      0
    ),
    Paid: statement.weekly.reduce(
      (sum, s) => sum + s.weeks.reduce((inner, w) => inner + (Number(w.paid) || 0), 0),
      0
    ),
    Status: '',
  });

  const fineRows = [
    ...statement.fines.pending.map((f) => ({
      Date: f.date || '',
      Type: f.type || '',
      Amount: f.amount || 0,
      'Still owed': f.remaining || 0,
      Reason: f.reason || '',
      Status: 'Outstanding',
    })),
    ...statement.fines.settled.map((f) => ({
      Date: f.date || '',
      Type: f.type || '',
      Amount: f.amount || 0,
      'Still owed': f.remaining || 0,
      Reason: f.reason || '',
      Status: 'Cleared',
    })),
  ];
  fineRows.push({
    Date: '',
    Type: 'TOTAL',
    Amount:
      statement.fines.pending.reduce((sum, f) => sum + (Number(f.amount) || 0), 0) +
      statement.fines.settledTotal,
    'Still owed': statement.fines.totalOwed,
    Reason: '',
    Status: '',
  });

  const contributionRows = statement.contributions.map((c, index) => ({
    '#': index + 1,
    Date: c.date || '',
    'Contribution type': c.type || '',
    Amount: c.amount || 0,
    'Payment method': c.method || '',
    'Fine deducted': c.fineDeducted || 0,
    'Cash received': c.grossAmount || c.amount || 0,
    'Group fund': c.isGroupFund ? 'Yes' : 'No',
    'Paid to date': c.runningBalance || 0,
  }));

  return [
    { name: 'Summary', rows: summaryRows },
    { name: 'By contribution type', rows: byTypeRows },
    { name: 'Month by month', rows: monthlyRows },
    { name: 'Weekly schedule', rows: weeklyRows },
    { name: 'Fines', rows: fineRows },
    { name: 'Contribution history', rows: contributionRows },
  ];
}

module.exports = {
  buildStatement,
  memberStatementSheets,
  reconciliationLines,
  money,
  shortDate,
};
