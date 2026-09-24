const PDFDocument = require('pdfkit');
const { CHAMA_NAME } = require('../data/branding');

// What the group has spent, as a document.
//
// Until now spending could be read on the member's own page and was subtracted from
// the headline on the reports screen, but there was no single record of it: a
// treasurer asked in a meeting "what has the Tea Fund spent this year?" had a screen
// and nothing to hand over. This is that record — the vouchers, the months, the funds
// and the arithmetic that takes it off what the members contributed.
//
// The figures come from computeMoneyPosition (utils/moneyPosition), the same function
// the reports summary uses, so the number printed here and the number on the reports
// screen cannot disagree.

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
function monthLabel(key) {
  const [year, month] = String(key).split('-');
  const index = Number(month) - 1;
  return `${MONTH_NAMES[index] || month} ${year}`;
}

// One expense, flattened once so the PDF, the workbook and the screen all read the
// same row. `month` is the group's own calendar month (EAT, UTC+3), as every other
// report groups it.
function mapExpense(expense) {
  const date = expense.date ? new Date(expense.date) : null;
  return {
    id: String(expense._id),
    date,
    month: date ? new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 7) : '',
    // The fund's id travels with the row so a screen correcting an entry can put the
    // picker back on the fund it was spent from, not on whichever is first.
    fundId: String(expense.typeId?._id || expense.typeId || ''),
    fund: expense.typeId?.name || 'Fund',
    description: expense.description || '',
    reference: expense.reference || '',
    note: expense.note || '',
    amount: Number(expense.amount) || 0,
    loggedBy: expense.loggedBy?.name || '',
  };
}

// Everything both the PDF and the workbook print.
function buildExpenseReport({ expenses, position, preparedBy = '' }) {
  const rows = expenses.map(mapExpense);
  const held = position || {};

  const fundNames = new Set(rows.map((r) => r.fund));
  const byFundMap = new Map();
  for (const row of rows) {
    const fund = byFundMap.get(row.fund) || { name: row.fund, spent: 0, count: 0 };
    fund.spent += row.amount;
    fund.count += 1;
    byFundMap.set(row.fund, fund);
  }

  // Each fund's standing: what the members put into it, what has left it, and what it
  // therefore holds. Loans and advances are split out here rather than in the
  // aggregation because a fund can be both (tea bought, a float lent out and owed
  // back), and money owed back is not money gone.
  const byFund = (held.funds || [])
    .filter((f) => f.tracksExpenses || fundNames.has(f.name))
    .map((f) => {
      const own = byFundMap.get(f.name) || { spent: 0, count: 0 };
      const advances = f.isRecoverable ? own.spent : 0;
      return {
        name: f.name,
        contributed: Number(f.collected) || 0,
        carriedIn: Number(f.carriedIn) || 0,
        derived: Number(f.derived) || 0,
        spent: own.spent,
        // What has left the fund but is still owed back to it — a loan or advance.
        advances,
        counted: f.isRecoverable ? 0 : own.spent,
        count: own.count,
        balance: Number(f.balance) || 0,
      };
    });

  // A fund the ledger no longer lists (deactivated after the money was spent) still
  // has to appear, or its spending would vanish from the totals it belongs to.
  for (const [name, own] of byFundMap) {
    if (!byFund.some((f) => f.name === name)) {
      byFund.push({
        name,
        contributed: 0,
        carriedIn: 0,
        derived: 0,
        spent: own.spent,
        advances: 0,
        counted: own.spent,
        count: own.count,
        balance: -own.spent,
      });
    }
  }
  byFund.sort((a, b) => b.spent - a.spent);

  const byMonthMap = new Map();
  for (const row of rows) {
    const month = byMonthMap.get(row.month) || { month: row.month, total: 0, count: 0 };
    month.total += row.amount;
    month.count += 1;
    byMonthMap.set(row.month, month);
  }
  const byMonth = [...byMonthMap.values()]
    .filter((m) => m.month)
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  const dates = rows.map((r) => r.date).filter(Boolean).map((d) => d.getTime());
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const advances = byFund.reduce((sum, f) => sum + f.advances, 0);

  return {
    rows: [...rows].sort((a, b) => b.date - a.date),
    byFund,
    byMonth,
    summary: {
      count: rows.length,
      total,
      // Money that left a fund but is still owed back to it, so a reader can see why
      // this total can be larger than the figure taken off the contributions.
      advances,
      counted: total - advances,
      fundCount: byFund.length,
      monthCount: byMonth.length,
      firstDate: dates.length ? new Date(Math.min(...dates)) : null,
      lastDate: dates.length ? new Date(Math.max(...dates)) : null,
    },
    money: {
      carriedIn: Number(held.carriedIn?.total) || 0,
      collected: Number(held.collected) || 0,
      totalContributed: Number(held.totalContributed) || 0,
      // Money gone, loans and advances excluded — the figure that comes off what the
      // members contributed.
      totalExpenses: Number(held.totalExpenses) || 0,
      netBalance: Number(held.netBalance) || 0,
    },
    preparedBy,
    generatedAt: new Date(),
  };
}

const MARGIN = 50;
const CONTENT_WIDTH = 495;

const EXPENSE_COLS = [
  { key: 'date', label: 'Date', x: MARGIN, width: 72 },
  { key: 'fund', label: 'Fund', x: MARGIN + 76, width: 92 },
  { key: 'description', label: 'What it was for', x: MARGIN + 172, width: 152 },
  { key: 'reference', label: 'Voucher', x: MARGIN + 328, width: 60 },
  { key: 'amount', label: 'Amount', x: MARGIN + 392, width: 72, align: 'right' },
];

const FUND_COLS = [
  { key: 'name', label: 'Fund', x: MARGIN, width: 130 },
  { key: 'contributed', label: 'In', x: MARGIN + 134, width: 88, align: 'right' },
  { key: 'spent', label: 'Out', x: MARGIN + 226, width: 88, align: 'right' },
  { key: 'balance', label: 'Holds now', x: MARGIN + 318, width: 88, align: 'right' },
  { key: 'count', label: 'Entries', x: MARGIN + 410, width: 85, align: 'right' },
];

function tableHeader(doc, y, cols) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#444');
  for (const col of cols) {
    doc.text(col.label, col.x, y, { width: col.width, align: col.align || 'left' });
  }
  doc.moveTo(MARGIN, y + 14).lineTo(MARGIN + CONTENT_WIDTH, y + 14).strokeColor('#ccc').stroke();
  doc.font('Helvetica').fillColor('#000');
  return y + 20;
}

function ensureRoom(doc, y, needed, cols) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (y + needed <= bottom) return y;
  doc.addPage();
  return cols ? tableHeader(doc, MARGIN, cols) : MARGIN;
}

function sectionTitle(doc, y, title) {
  y = ensureRoom(doc, y, 34);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#b3261e').text(title, MARGIN, y);
  doc.fillColor('#000').font('Helvetica');
  return y + 18;
}

// Streams the group's spending as a PDF.
function renderExpenseReportPdf(res, report, chamaName) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="expenses.pdf"');

  const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(17).text(chamaName || CHAMA_NAME);
  doc.font('Helvetica').fontSize(10).fillColor('#666').text('Fund spending - group record');
  doc.moveDown(0.8);
  doc.fillColor('#000');

  // ------------------------------------------------------------- the money
  let y = sectionTitle(doc, doc.y, 'What the group holds');
  const summaryLines = [
    ['Money in, all time (members and funds)', money(report.money.totalContributed)],
    ['of which carried in from the paper ledger', money(report.money.carriedIn)],
    ['of which paid in since the books opened', money(report.money.collected)],
    ['Spent out of the funds (loans and advances excluded)', money(report.money.totalExpenses)],
    ['Held by the group now', money(report.money.netBalance)],
    [
      'Expenses on this report',
      `${report.summary.count}${report.summary.count === 1 ? ' entry' : ' entries'}`,
    ],
    ['Spent on this report', money(report.summary.total)],
    ['of which still owed back (loans and advances)', money(report.summary.advances)],
    [
      'Period covered',
      report.summary.firstDate
        ? `${shortDate(report.summary.firstDate)} - ${shortDate(report.summary.lastDate)}`
        : '—',
    ],
    ['Report generated', shortDate(new Date())],
  ];

  for (const [label, value] of summaryLines) {
    y = ensureRoom(doc, y, 14);
    doc.font('Helvetica').fontSize(9);
    doc.text(label, MARGIN, y, { width: 300 });
    doc.text(value, MARGIN + 300, y, { width: 195, align: 'right' });
    y += 14;
  }
  y += 8;

  // -------------------------------------------------------------- by fund
  y = sectionTitle(doc, y, 'How each fund stands');
  y = tableHeader(doc, y, FUND_COLS);

  if (report.byFund.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#666').text('No spending on record.', MARGIN, y);
    doc.fillColor('#000');
    y = doc.y;
  }

  for (const fund of report.byFund) {
    y = ensureRoom(doc, y, fund.advances > 0 ? 25 : 14, FUND_COLS);
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    doc.text(fund.name, FUND_COLS[0].x, y, { width: FUND_COLS[0].width });
    doc.text(money(fund.contributed + fund.carriedIn + fund.derived), FUND_COLS[1].x, y, {
      width: FUND_COLS[1].width,
      align: 'right',
    });
    doc.text(money(fund.spent), FUND_COLS[2].x, y, { width: FUND_COLS[2].width, align: 'right' });
    doc.text(money(fund.balance), FUND_COLS[3].x, y, { width: FUND_COLS[3].width, align: 'right' });
    doc.text(String(fund.count), FUND_COLS[4].x, y, { width: FUND_COLS[4].width, align: 'right' });
    y += 14;
    if (fund.advances > 0) {
      doc.font('Helvetica').fontSize(8).fillColor('#666');
      doc.text(`${money(fund.advances)} of that is a loan or advance, still owed back`, FUND_COLS[0].x, y, {
        width: CONTENT_WIDTH,
        align: 'right',
      });
      doc.fillColor('#000');
      y += 11;
    }
  }
  y += 8;

  // ------------------------------------------------------------- by month
  if (report.byMonth.length > 0) {
    y = sectionTitle(doc, y, 'Spending by month');
    for (const month of report.byMonth) {
      y = ensureRoom(doc, y, 14);
      doc.font('Helvetica').fontSize(9);
      doc.text(monthLabel(month.month), MARGIN, y, { width: 200 });
      doc.text(`${month.count}${month.count === 1 ? ' entry' : ' entries'}`, MARGIN + 200, y, {
        width: 150,
      });
      doc.text(money(month.total), MARGIN + 350, y, { width: 145, align: 'right' });
      y += 14;
    }
    y += 8;
  }

  // -------------------------------------------------------- every expense
  y = sectionTitle(doc, y, 'Every expense, newest first');
  y = tableHeader(doc, y, EXPENSE_COLS);

  if (report.rows.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#666').text('Nothing has been spent yet.', MARGIN, y);
    doc.fillColor('#000');
    y = doc.y;
  }

  for (const row of report.rows) {
    const detail = [
      row.note ? `Note: ${row.note}` : '',
      row.loggedBy ? `Logged by ${row.loggedBy}` : '',
    ]
      .filter(Boolean)
      .join('  ·  ');
    y = ensureRoom(doc, y, detail ? 28 : 14, EXPENSE_COLS);
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    doc.text(shortDate(row.date), EXPENSE_COLS[0].x, y, { width: EXPENSE_COLS[0].width });
    doc.text(row.fund, EXPENSE_COLS[1].x, y, { width: EXPENSE_COLS[1].width });
    doc.text(row.description || '—', EXPENSE_COLS[2].x, y, { width: EXPENSE_COLS[2].width });
    doc.text(row.reference || '—', EXPENSE_COLS[3].x, y, { width: EXPENSE_COLS[3].width });
    doc.font('Helvetica-Bold').text(money(row.amount), EXPENSE_COLS[4].x, y, {
      width: EXPENSE_COLS[4].width,
      align: 'right',
    });
    doc.font('Helvetica');
    if (detail) {
      doc.font('Helvetica').fontSize(8).fillColor('#666');
      doc.text(detail, EXPENSE_COLS[0].x, y + 11, { width: CONTENT_WIDTH });
      doc.fillColor('#000');
    }
    y += detail ? 28 : 14;
  }

  // -------------------------------------------------------------- footer
  y = ensureRoom(doc, y + 10, 40);
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').stroke();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#666')
    .text(
      'Taken from the group\u2019s own expense records. An expense is deducted from what the ' +
        'members contributed the moment it is logged, and deleting one (which the audit trail ' +
        'records) puts the money back. Loans and advances are listed but not deducted: that ' +
        'money is still owed to the group.',
      MARGIN,
      y + 8,
      { width: CONTENT_WIDTH }
    );

  doc.end();
}

// The workbook: the same record, in sheets the office can sort and total.
function expenseReportSheets(report, chamaName) {
  const summaryRows = [
    { Field: 'Chama', Value: chamaName || '' },
    { Field: 'Report', Value: 'Fund spending' },
    { Field: 'Money in, all time', Value: report.money.totalContributed },
    { Field: 'Carried in from the paper ledger', Value: report.money.carriedIn },
    { Field: 'Paid in since the books opened', Value: report.money.collected },
    { Field: 'Spent out of the funds (deducted)', Value: report.money.totalExpenses },
    { Field: 'Held by the group now', Value: report.money.netBalance },
    { Field: 'Expenses on this report', Value: report.summary.count },
    { Field: 'Spent on this report', Value: report.summary.total },
    { Field: 'Still owed back (loans and advances)', Value: report.summary.advances },
    {
      Field: 'Period covered',
      Value: report.summary.firstDate
        ? `${shortDate(report.summary.firstDate)} - ${shortDate(report.summary.lastDate)}`
        : '',
    },
    { Field: 'Prepared by', Value: report.preparedBy || '' },
    { Field: 'Generated on', Value: report.generatedAt },
  ];

  const expenseRows = report.rows.map((row) => ({
    Date: row.date,
    Month: monthLabel(row.month),
    Fund: row.fund,
    'What it was for': row.description,
    Voucher: row.reference,
    Amount: row.amount,
    'Logged by': row.loggedBy,
    Note: row.note,
  }));
  expenseRows.push({
    Date: '',
    Month: '',
    Fund: 'TOTAL',
    'What it was for': '',
    Voucher: '',
    Amount: report.summary.total,
    'Logged by': '',
    Note: '',
  });

  const fundRows = report.byFund.map((fund) => ({
    Fund: fund.name,
    'Carried in': fund.carriedIn,
    'Paid in since': fund.contributed,
    'Derived income': fund.derived,
    'Spent (deducted)': fund.counted,
    'Loans and advances': fund.advances,
    'Holds now': fund.balance,
    Entries: fund.count,
  }));
  const fundTotal = (key) => report.byFund.reduce((sum, f) => sum + f[key], 0);
  fundRows.push({
    Fund: 'TOTAL',
    'Carried in': fundTotal('carriedIn'),
    'Paid in since': fundTotal('contributed'),
    'Derived income': fundTotal('derived'),
    'Spent (deducted)': fundTotal('counted'),
    'Loans and advances': fundTotal('advances'),
    'Holds now': fundTotal('balance'),
    Entries: report.summary.count,
  });

  const monthRows = report.byMonth.map((month) => ({
    Month: monthLabel(month.month),
    Entries: month.count,
    Spent: month.total,
  }));

  return [
    { name: 'Summary', rows: summaryRows },
    { name: 'Expenses', rows: expenseRows },
    { name: 'By fund', rows: fundRows },
    { name: 'By month', rows: monthRows },
  ];
}

module.exports = {
  buildExpenseReport,
  renderExpenseReportPdf,
  expenseReportSheets,
  mapExpense,
};

