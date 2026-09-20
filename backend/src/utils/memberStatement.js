const PDFDocument = require('pdfkit');
const { sendWorkbook } = require('./xlsxExport');

// The member's statement, in both of the formats it is asked for: a PDF to read on
// a phone, and a workbook the office keeps. Both are built from the same profile
// (see buildPublicProfile), so a member's own download and the office's copy can
// never tell two different stories — the one difference between them is whether
// the Tea Fund is named.
//
// Pledges are gone from this system, so nothing here asks what a member promised:
// a statement is a record of what actually moved.

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

  // Month by month, his own money only: a group fund he paid into is not his
  // contribution, and the passbook already keeps it out of his total.
  const byMonth = new Map();
  for (const c of contributions) {
    if (c.isGroupFund) continue;
    const key = monthKeyOf(c.date);
    byMonth.set(key, (byMonth.get(key) || 0) + (Number(c.amount) || 0));
  }
  const monthly = lastMonthKeys().map((key) => ({
    month: key,
    label: monthLabelOf(key),
    amount: byMonth.get(key) || 0,
  }));

  // The weekly schedule, newest week first — the week just gone is the one a
  // member looks for. The weeks before the cycle opened (1..91) are summarised
  // rather than listed: ninety lines of "carried forward" is a wall, not a
  // statement, and that money is inside the carried-forward figure anyway.
  const weekly = (profile.weeklySchedules || []).map((schedule) => ({
    typeName: schedule.typeName,
    weeklyAmount: schedule.weeklyAmount,
    weeks: [...(schedule.weeks || [])].reverse().map((w) => ({
      weekNumber: w.weekNumber,
      startDate: w.startDate,
      endDate: w.endDate,
      expected: w.expected,
      paid: w.paid,
      status: STATUS_LABELS[w.status] || w.status || '',
      isBaseline: Boolean(w.isBaseline),
      isCurrent: Boolean(w.isCurrent),
    })),
    historyCount: (schedule.history || []).length,
    historyPaid: (schedule.history || []).reduce((sum, w) => sum + (Number(w.paid) || 0), 0),
  }));

  const figures = [
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
      // One deduction figure for a member's own copy: the weekly contribution and
      // what the Group deducts alongside it. The office's copy breaks the tea out.
      label: 'Due so far (the weeks that have closed)',
      value: ledger ? (profile.teaFundIncluded ? ledger.required : ledger.required + ledger.tea) : 0,
    },
  ];

  if (ledger && profile.teaFundIncluded) {
    figures.push({ label: 'Tea (deducted automatically, Group fund)', value: ledger.tea });
  }

  figures.push(
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
    { label: 'Statement generated', value: shortDate(new Date()) }
  );

  return {
    member: {
      name: profile.name || '',
      regNumber: profile.regNumber || '',
      phoneMasked: profile.phoneMasked || '',
    },
    figures,
    byType: profile.byType || [],
    monthly,
    monthlyTotal: monthly.reduce((sum, m) => sum + m.amount, 0),
    weekly,
    weeksShown: WEEKS_SHOWN,
    fines: {
      pending: fines.pending || [],
      settled: fines.settled || [],
      totalOwed: fines.totalOwed || 0,
      settledTotal: (fines.settled || []).reduce((sum, f) => sum + (Number(f.amount) || 0), 0),
    },
    contributions,
    teaFundIncluded: Boolean(profile.teaFundIncluded),
  };
}

// The workbook: one sheet per question the office asks. Summary first, then what
// he paid by type, month by month, the weekly schedule, his fines, and finally
// every row behind the figures.
function memberStatementSheets(profile, chamaName) {
  const statement = buildStatement(profile);
  const paidInRows = Number(
    (statement.figures.find((f) => f.label === 'Paid in the rows below') || {}).value || 0
  );

  const summaryRows = [
    { Field: 'Chama', Value: chamaName || '' },
    { Field: 'Member', Value: statement.member.name },
    { Field: 'Registration number', Value: statement.member.regNumber },
    ...statement.figures.map((f) => ({ Field: f.label, Value: f.value })),
  ];

  const byTypeRows = statement.byType.map((b) => ({
    'Contribution type': b.type || '',
    Contributed: b.contributed || 0,
    'Share of the rows (%)': paidInRows > 0 ? Number((((b.contributed || 0) / paidInRows) * 100).toFixed(1)) : 0,
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
    Month: `TOTAL (last ${MONTHS_SHOWN} months)`,
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

module.exports = { buildStatement, memberStatementSheets, money, shortDate };
