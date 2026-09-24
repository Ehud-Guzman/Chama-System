// What the group has spent, as a report.
//
// The point of this report is a subtraction: money spent out of the funds comes off
// what the members contributed, and the figures printed on the page have to be the
// figures the reports screen shows. So the arithmetic is checked here — including that
// a loan is listed but NOT deducted, which is the one place the two totals are allowed
// to differ, and the reason the split exists at all.
//
// No database and no HTTP: the builder takes the expenses and the money position as
// arguments, which is what makes that possible.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');

const {
  buildExpenseReport,
  expenseReportSheets,
  renderExpenseReportPdf,
} = require('../src/utils/expenseReport');

// One expense as the controller hands it over: populated fund and logger. `fromGroup`
// makes it a purchase the group made as a whole, which names no fund at all.
function expense({
  fund = 'Chai',
  amount,
  date,
  description = 'Tea',
  reference = '',
  note = '',
  fromGroup = false,
}) {
  return {
    _id: `${fund}-${date}-${amount}`,
    amount,
    date: new Date(date),
    description,
    reference,
    note,
    deleted: false,
    source: fromGroup ? 'group' : 'fund',
    typeId: fromGroup ? null : { name: fund },
    loggedBy: { name: 'Victor' },
  };
}

// The money position, as utils/moneyPosition computes it.
function position({ funds = [], overrides = {} } = {}) {
  const spent = funds.reduce((sum, f) => sum + f.spent, 0);
  return {
    carriedIn: { memberBalances: 3_200_000, fundFloats: 200_000, total: 3_400_000 },
    collected: 44_800,
    totalContributed: 3_444_800,
    totalExpenses: spent,
    netBalance: 3_444_800 - spent,
    funds: funds.map((f) => ({
      tracksExpenses: true,
      isRecoverable: false,
      derived: 0,
      ...f,
    })),
    ...overrides,
  };
}

const FIXTURES = [
  expense({ amount: 2500, date: '2026-09-10', description: 'Tea and mandazi', reference: 'V-014' }),
  expense({ amount: 1000, date: '2026-09-04', description: 'Water' }),
  expense({ amount: 500, date: '2026-08-02', description: 'Sugar' }),
];

const CHAI = {
  typeId: 't1',
  name: 'Chai',
  carriedIn: 5000,
  collected: 12_000,
  derived: 1400,
  spent: 4000,
  balance: 14_400,
};

test('spending is deducted from what was contributed, line by line', () => {
  const report = buildExpenseReport({ expenses: FIXTURES, position: position({ funds: [CHAI] }) });

  assert.equal(report.summary.count, 3);
  assert.equal(report.summary.total, 4000);
  assert.equal(report.money.totalContributed, 3_444_800);
  // The one subtraction the whole report exists for.
  assert.equal(report.money.totalExpenses, 4000);
  assert.equal(report.money.netBalance, 3_444_800 - 4000);
  assert.equal(report.money.carriedIn, 3_400_000);
  assert.equal(report.money.collected, 44_800);
});

test('what is still owed back is listed but not deducted', () => {
  const report = buildExpenseReport({
    // A fund whose payouts are loans: the money left it, but it is owed back, so the
    // net position must not treat it as gone.
    expenses: [
      ...FIXTURES,
      expense({ fund: 'Welfare', amount: 400, date: '2026-09-06', description: 'Advance' }),
    ],
    position: position({
      funds: [
        CHAI,
        { ...CHAI, typeId: 't2', name: 'Welfare', isRecoverable: true, spent: 400, balance: 2600 },
      ],
    }),
  });

  const welfare = report.byFund.find((f) => f.name === 'Welfare');
  assert.equal(welfare.spent, 400);
  assert.equal(welfare.advances, 400);
  assert.equal(welfare.counted, 0, 'a recoverable fund is not part of the deducted total');

  // And the page says so out loud, in the totals a reader checks first.
  assert.equal(report.summary.advances, 400);
  assert.equal(report.summary.counted, report.summary.total - 400);
  assert.equal(report.summary.total, 4400, 'the report still lists every payout');
});

test('each fund is totalled from the rows, and a fund the ledger has dropped still shows', () => {
  const report = buildExpenseReport({
    expenses: [...FIXTURES, expense({ fund: 'Old Welfare', amount: 750, date: '2026-07-01' })],
    position: position({ funds: [CHAI] }),
  });

  const chai = report.byFund.find((f) => f.name === 'Chai');
  assert.equal(chai.count, 3);
  assert.equal(chai.spent, 4000);
  assert.equal(chai.balance, 14_400, 'the balance is the ledger\u2019s own, not recomputed here');
  // 5000 + 12000 + 1400 = 18400 in, 4000 out.
  assert.equal(chai.contributed + chai.carriedIn + chai.derived, 18_400);

  const dropped = report.byFund.find((f) => f.name === 'Old Welfare');
  assert.ok(dropped, 'spending by a fund that no longer exists must not vanish');
  assert.equal(dropped.spent, 750);
  assert.equal(dropped.balance, -750);

  // Biggest spender first, so the list reads the way a meeting asks about it.
  assert.deepEqual(
    report.byFund.map((f) => f.name),
    ['Chai', 'Old Welfare']
  );
});

test('the month cut groups by the group\u2019s own calendar month, newest first', () => {
  const report = buildExpenseReport({ expenses: FIXTURES, position: position({ funds: [CHAI] }) });

  assert.deepEqual(
    report.byMonth.map((m) => [m.month, m.total, m.count]),
    [
      ['2026-09', 3500, 2],
      ['2026-08', 500, 1],
    ]
  );

  // The rows themselves come newest first, which is the order the PDF prints them in.
  assert.deepEqual(
    report.rows.map((r) => r.amount),
    [2500, 1000, 500]
  );
  assert.equal(report.summary.firstDate.toISOString().slice(0, 10), '2026-08-02');
  assert.equal(report.summary.lastDate.toISOString().slice(0, 10), '2026-09-10');
});

test('the workbook carries the vouchers, the funds and the months, with a total row', () => {
  const report = buildExpenseReport({
    expenses: FIXTURES,
    position: position({ funds: [CHAI] }),
    preparedBy: 'Victor',
  });
  const sheets = expenseReportSheets(report, 'Wazo Moja Self-Help Group');

  assert.deepEqual(
    sheets.map((s) => s.name),
    ['Summary', 'Expenses', 'By fund', 'By month']
  );

  const summary = Object.fromEntries(sheets[0].rows.map((r) => [r.Field, r.Value]));
  assert.equal(summary['Money in, all time'], 3_444_800);
  assert.equal(summary['Spent in total (loans excluded)'], 4000);
  assert.equal(summary['Of that, out of the funds'], 4000);
  assert.equal(summary["Of that, out of the group's total money"], 0);
  assert.equal(summary['Held by the group now'], 3_440_800);
  assert.equal(summary['Prepared by'], 'Victor');

  const rows = sheets[1].rows;
  assert.equal(rows.at(-1).Fund, 'TOTAL');
  assert.equal(rows.at(-1).Amount, 4000);
  assert.equal(rows[0].Voucher, 'V-014');
  assert.equal(rows[0]['Logged by'], 'Victor');

  const fundTotal = sheets[2].rows.at(-1);
  assert.equal(fundTotal.Fund, 'TOTAL');
  assert.equal(fundTotal['Holds now'], 14_400);

  // Nothing is invented for a month with no spending.
  assert.deepEqual(
    sheets[3].rows.map((r) => [r.Month, r.Spent]),
    [
      ['Sep 2026', 3500],
      ['Aug 2026', 500],
    ]
  );
});

test('the PDF is written, and names the group it belongs to', async () => {
  const report = buildExpenseReport({
    expenses: FIXTURES,
    position: position({ funds: [CHAI] }),
    preparedBy: 'Victor',
  });

  // A real writable stream, because PDFKit pipes into it — a stub with write/end would
  // throw before a byte was produced. setHeader comes from the response object it
  // stands in for.
  const headers = {};
  const sink = new PassThrough();
  sink.setHeader = (name, value) => {
    headers[name] = value;
  };
  const chunks = [];
  sink.on('data', (chunk) => chunks.push(chunk));

  renderExpenseReportPdf(sink, report, 'Wazo Moja Self-Help Group');
  await new Promise((resolve) => sink.on('end', resolve));

  const pdf = Buffer.concat(chunks).toString('latin1');
  assert.equal(headers['Content-Type'], 'application/pdf');
  assert.match(headers['Content-Disposition'], /expenses\.pdf/);
  assert.match(pdf, /^%PDF-/, 'a real PDF, not an empty stream');
  assert.match(pdf, /%%EOF/, 'and a finished one, not a truncated file');
  // Long enough to hold the tables the report is made of: a header, a summary block,
  // the fund and month tables and the expense list. (The text itself is compressed in
  // the content stream, which is why this checks the shape rather than the words.)
  assert.ok(pdf.length > 2000, `the PDF should carry the report's tables, got ${pdf.length} bytes`);
});

test('a group that has spent nothing still gets a report, not an empty screen', () => {
  const report = buildExpenseReport({
    expenses: [],
    // The fund has taken money in but spent none of it.
    position: position({ funds: [{ ...CHAI, spent: 0, balance: 18_400 }] }),
  });

  assert.equal(report.summary.count, 0);
  assert.equal(report.summary.total, 0);
  assert.equal(report.summary.firstDate, null);
  assert.deepEqual(report.byMonth, []);
  assert.equal(report.byFund[0].name, 'Chai', 'the fund still shows what it holds');
  assert.equal(report.byFund[0].balance, 18_400);
  assert.equal(report.money.netBalance, 3_444_800);
});

test('the group\u2019s own funds add up to a figure with the spending already off it', () => {
  const { groupFundTotals } = require('../src/utils/moneyPosition');

  const total = groupFundTotals([
    // A fund money is bought out of.
    {
      name: 'Chai',
      isRecoverable: false,
      carriedIn: 5000,
      collected: 12_000,
      derived: 1400,
      spent: 4000,
      balance: 14_400,
    },
    // A loan fund: its payouts left the fund, but they are owed back, so they are not
    // part of what the group has spent.
    {
      name: 'Welfare loan',
      isRecoverable: true,
      carriedIn: 0,
      collected: 3000,
      derived: 0,
      spent: 1000,
      balance: 2000,
    },
  ]);

  assert.equal(total.in, 21_400, '5,000 + 12,000 + 1,400 + 3,000 came into the funds');
  assert.equal(total.spent, 4000, 'only the Chai spending is money gone');
  assert.equal(total.onLoan, 1000, 'the loan is named separately');
  assert.equal(total.holds, 16_400, '14,400 + 2,000 is what the two funds hold');
  assert.equal(total.funds, 2);
  // The line a reader checks: money in, less what is gone, less what is owed back.
  assert.equal(total.in - total.spent - total.onLoan, total.holds);
});

test('the report states the group fund total, and the workbook carries it', () => {
  const report = buildExpenseReport({ expenses: FIXTURES, position: position({ funds: [CHAI] }) });
  const gf = report.money.groupFund;

  assert.equal(gf.holds, 14_400, 'what the funds hold, spending already off');
  assert.equal(gf.in, 18_400, '5,000 carried in + 12,000 paid in + 1,400 automatic tea');
  assert.equal(gf.spent, 4000);
  assert.equal(gf.onLoan, 0);

  const summary = Object.fromEntries(
    expenseReportSheets(report, 'Wazo Moja Self-Help Group')[0].rows.map((r) => [r.Field, r.Value])
  );
  assert.equal(summary['Group funds hold (all funds together)'], 14_400);
  assert.equal(summary['Group funds - spent and gone'], 4000);
});

test('money spent out of the group\u2019s total money is not a fund gone overdrawn', () => {
  const report = buildExpenseReport({
    expenses: [
      ...FIXTURES,
      // A group purchase: no fund behind it, because the group bought it as a whole.
      expense({
        fund: undefined,
        amount: 200_000,
        date: '2026-09-12',
        description: 'Land at Ngong',
        reference: 'TITLE/4471',
        fromGroup: true,
      }),
    ],
    // The position as moneyPosition() computes it once the group has also spent out of
    // its total money: the deduction split into the two places the money came from.
    position: position({
      funds: [CHAI],
      overrides: {
        totalExpenses: 204_000,
        spentFromFunds: 4000,
        spentFromGroupTotal: 200_000,
        netBalance: 3_444_800 - 204_000,
      },
    }),
  });

  // It counts as money gone — the group's total is 200,000 lighter — but it is not a
  // fund's spending, so the funds' table is untouched and still adds up.
  assert.equal(report.summary.total, 204_000);
  assert.equal(report.summary.spentFromGroupTotal, 200_000);
  assert.equal(report.summary.spentFromFunds, 4000);
  assert.deepEqual(
    report.byFund.map((f) => f.name),
    ['Chai'],
    'the group\u2019s purchase must not appear as a fund'
  );
  assert.equal(report.byFund[0].spent, 4000);

  // The row itself says where the money came from, so the list and the documents read
  // the same way.
  const land = report.rows.find((r) => r.description === 'Land at Ngong');
  assert.equal(land.fromGroupTotal, true);
  assert.equal(land.fund, "The group's total money");
  assert.equal(land.fundId, '');

  // And the money block names both halves of the deduction.
  assert.equal(report.money.spentFromGroupTotal, 200_000);
  assert.equal(report.money.spentFromFunds, 4000);
  assert.equal(report.money.totalExpenses, 4000 + 200_000);

  const sheets = expenseReportSheets(report, 'Wazo Moja Self-Help Group');
  const summary = Object.fromEntries(sheets[0].rows.map((r) => [r.Field, r.Value]));
  assert.equal(summary["Of that, out of the group's total money"], 200_000);
  assert.equal(summary['Of that, out of the funds'], 4000);
  const rows = sheets[1].rows;
  assert.equal(rows[0].Fund, "The group's total money", 'newest first, and named as such');
});

