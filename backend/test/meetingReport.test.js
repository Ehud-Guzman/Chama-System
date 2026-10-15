// The meeting report: the page the office hands round, with each section closed by its total.
//
// What is pinned here is the arithmetic and the decisions the page makes for the reader — who is
// below the money line and who is above it, that a member exactly on it is above with nothing
// extra, that a loan is listed but not counted as spent, that a section nobody asked for is not
// built — and that the totals really reach the paper, by reading the PDF's own text back.
//
// No database and no HTTP: the builder takes the figures as arguments.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');

const {
  SECTION_KEYS,
  parseSections,
  expensePeriod,
  splitByLine,
  buildMeetingReport,
  renderMeetingReportPdf,
} = require('../src/utils/meetingReport');

const LINE = 117_400;

function member(name, held, weeksUnpaid = 0, regNumber = '') {
  return { memberId: name, name, regNumber, held, weeksUnpaid };
}

const MEMBERS = [
  member('Alice', LINE + 5000, 0, 'WM-0001'), // above
  member('Brian', LINE - 4400, 1, 'WM-0002'), // below, a week unpaid
  member('Carol', LINE, 0, 'WM-0003'), // exactly on the line
  member('Daniel', LINE - 100, 0, 'WM-0004'), // below by the tea alone: nothing unpaid
  member('Esther', LINE + 300, 2, 'WM-0005'), // above, with unpaid weeks the line leaves alone
];

const WEEK = {
  weekNumber: 94,
  startDate: new Date('2026-10-09T00:00:00+03:00'),
  endDate: new Date('2026-10-15T23:59:59+03:00'),
  weeklyAmount: 1400,
  members: 5,
  expected: 7000,
  paid: 4200,
  shortfall: 2800,
  paidCount: 3,
  partialCount: 0,
  noneCount: 2,
  percent: 60,
  settled: false,
};

const POSITION = {
  carriedIn: { total: 3_400_000 },
  collected: 44_800,
  totalContributed: 3_444_800,
  totalExpenses: 4000,
  spentFromFunds: 4000,
  spentFromGroupTotal: 0,
  netBalance: 3_440_800,
  groupFund: { in: 21_400, spent: 4000, onLoan: 1000, holds: 16_400 },
  funds: [
    { name: 'Chai', carriedIn: 5000, collected: 12_000, derived: 1400, spent: 4000, balance: 14_400, isRecoverable: false },
    { name: 'Welfare loan', carriedIn: 0, collected: 3000, derived: 0, spent: 1000, balance: 2000, isRecoverable: true },
  ],
};

const FINES = {
  totals: {
    count: 4,
    issued: 3000,
    outstanding: 1800,
    cleared: 1200,
    pendingCount: 3,
    clearedCount: 1,
    membersOwing: 2,
    oldestUnpaid: new Date('2026-08-14'),
  },
  byType: [{ name: 'Late to meeting', category: 'conduct', issued: 3000, outstanding: 1800, count: 4 }],
  byMember: [
    {
      name: 'Brian',
      regNumber: 'WM-0002',
      active: true,
      fines: 2,
      issued: 1500,
      outstanding: 1000,
      oldestUnpaid: new Date('2026-08-14'),
      types: [{ name: 'Late to meeting', count: 2 }],
    },
    {
      name: 'Daniel',
      regNumber: 'WM-0004',
      active: true,
      fines: 1,
      issued: 800,
      outstanding: 800,
      oldestUnpaid: new Date('2026-09-02'),
      types: [{ name: 'Late to meeting', count: 1 }],
    },
  ],
  byMemberTruncated: false,
  byMemberLimit: 500,
};

function expense({ amount, date, fund = 'Chai', description = 'Tea', recoverable = false, fromGroup = false }) {
  return {
    _id: `${fund}-${date}-${amount}`,
    amount,
    date: new Date(date),
    description,
    reference: '',
    note: '',
    deleted: false,
    source: fromGroup ? 'group' : 'fund',
    typeId: fromGroup ? null : { name: fund, isRecoverable: recoverable },
    loggedBy: { name: 'Victor' },
  };
}

const EXPENSES = [
  expense({ amount: 2500, date: '2026-10-10T09:00:00Z', description: 'Tea and mandazi' }),
  expense({ amount: 1500, date: '2026-10-12T09:00:00Z', description: 'Water' }),
  expense({ amount: 1000, date: '2026-10-13T09:00:00Z', fund: 'Welfare loan', recoverable: true, description: 'Advance' }),
  expense({ amount: 50_000, date: '2026-10-14T09:00:00Z', fromGroup: true, description: 'Plot at Ngong' }),
];

const PERIOD = { key: 'month', label: 'October 2026', from: new Date('2026-09-30T21:00:00Z'), to: new Date('2026-10-31T20:59:59Z') };

function build(overrides = {}) {
  return buildMeetingReport({
    chamaName: 'Wazo Moja Self-Help Group',
    preparedBy: 'Victor',
    generatedAt: new Date('2026-10-15T18:00:00Z'),
    week: WEEK,
    line: LINE,
    members: MEMBERS,
    position: POSITION,
    finesCollected: 3100,
    fines: FINES,
    expenses: EXPENSES,
    period: PERIOD,
    ...overrides,
  });
}

// ------------------------------------------------------------------------------- the request

test('no sections named means every section, in the page’s own order', () => {
  assert.deepEqual(parseSections(undefined).sections, SECTION_KEYS);
  assert.deepEqual(SECTION_KEYS, ['position', 'week', 'debts', 'extra', 'fines', 'expenses']);
});

test('the sections asked for come back once each, in print order, whatever order they were asked in', () => {
  assert.deepEqual(parseSections('fines,debts,fines').sections, ['debts', 'fines']);
  // Express hands a repeated query key over as an array.
  assert.deepEqual(parseSections(['expenses', 'position']).sections, ['position', 'expenses']);
  assert.deepEqual(parseSections(' Debts , EXTRA ').sections, ['debts', 'extra']);
});

test('an unknown or empty section is refused rather than quietly dropped', () => {
  assert.match(parseSections('debts,loans').error, /Unknown section: loans/);
  assert.match(parseSections('').error, /at least one section/);
  assert.match(parseSections(',,').error, /at least one section/);
});

// -------------------------------------------------------------------------- the money line split

test('below the line is a debt, at or above it is extra, each with how far', () => {
  const split = splitByLine(MEMBERS, LINE);

  assert.equal(split.off, false);
  assert.deepEqual(
    split.below.map((m) => [m.name, m.short]),
    [
      ['Brian', 4400],
      ['Daniel', 100],
    ],
    'biggest gap first'
  );
  assert.deepEqual(
    split.above.map((m) => [m.name, m.extra]),
    [
      ['Alice', 5000],
      ['Esther', 300],
      ['Carol', 0],
    ],
    'biggest surplus first, and a member exactly on the line is above it with nothing extra'
  );
  // Nobody is in both lists and nobody is in neither.
  assert.equal(split.below.length + split.above.length, MEMBERS.length);
});

test('a shilling below the line is below it', () => {
  const split = splitByLine([member('Near', LINE - 1)], LINE);
  assert.equal(split.below.length, 1);
  assert.equal(split.below[0].short, 1);
});

test('a line of zero is the group switching the rule off, and nobody is measured against it', () => {
  const split = splitByLine(MEMBERS, 0);
  assert.equal(split.off, true);
  assert.deepEqual(split.below, []);
  assert.deepEqual(split.above, []);

  const report = build({ line: 0 });
  assert.equal(report.debts.off, true);
  assert.equal(report.extra.off, true);
  assert.ok(
    report.glance.some(([label, value]) => label === 'Below the money line' && /switched off/.test(value)),
    'the glance says so rather than printing "0 members"'
  );
});

// ---------------------------------------------------------------------------------- the totals

test('the debts and extra sections total exactly what their rows add up to', () => {
  const report = build();

  assert.equal(report.debts.totals.count, 2);
  assert.equal(report.debts.totals.total, 4500, '4,400 + 100');
  assert.equal(report.debts.totals.members, 5);
  // Daniel is under the line by the tea alone: nothing unpaid, and the page counts him so it can say so.
  assert.equal(report.debts.totals.noUnpaidWeek, 1);

  assert.equal(report.extra.totals.count, 3);
  assert.equal(report.extra.totals.total, 5300, '5,000 + 300 + 0');
  assert.equal(report.extra.line, LINE);
});

test('the fines section carries the group’s totals and totals the list it prints', () => {
  const { fines } = build();

  assert.equal(fines.totals.outstanding, 1800);
  assert.equal(fines.totals.membersOwing, 2);
  assert.equal(fines.byMember.length, 2);
  assert.equal(fines.owedByListed, 1800, '1,000 + 800');
  assert.equal(fines.finesListed, 3);
  assert.equal(fines.truncated, false);
});

test('a fines list that was cut says so, and a member who owes nothing is not listed', () => {
  const { fines } = build({
    fines: {
      ...FINES,
      byMember: [...FINES.byMember, { name: 'Cleared', fines: 1, issued: 500, outstanding: 0, types: [] }],
      byMemberTruncated: true,
      byMemberLimit: 2,
    },
  });
  assert.equal(fines.byMember.length, 2);
  assert.equal(fines.truncated, true);
});

test('a loan is listed but not counted as spent', () => {
  const { expenses } = build();

  assert.equal(expenses.totals.count, 4);
  assert.equal(expenses.totals.total, 55_000, 'everything listed');
  assert.equal(expenses.totals.owedBack, 1000, 'the advance is still owed back');
  assert.equal(expenses.totals.spent, 54_000, 'tea, water and the plot: money gone');

  // Newest first, with a group purchase named as one rather than as a fund.
  assert.equal(expenses.rows[0].description, 'Plot at Ngong');
  assert.equal(expenses.rows[0].fund, "The group's total money");
  const byFund = Object.fromEntries(expenses.byFund.map((f) => [f.name, f.amount]));
  assert.equal(byFund.Chai, 4000);
  assert.equal(byFund['Welfare loan'], 1000);
  assert.equal(byFund["The group's total money"], 50_000);
});

test('the position carries the funds with the arithmetic that closes them', () => {
  const { position } = build();

  assert.equal(position.held, 3_440_800);
  assert.equal(position.moneyIn, position.carriedIn + position.paidIn, 'in = carried in + paid in');
  const chai = position.funds.find((f) => f.name === 'Chai');
  assert.equal(chai.in, 18_400, '5,000 + 12,000 + 1,400');
  assert.equal(chai.holds, 14_400);
  // Out is everything that left the funds, loans included, so in - out = holds can be checked.
  assert.equal(position.fundTotals.out, 5000);
  assert.equal(position.fundTotals.in - position.fundTotals.out, position.fundTotals.holds);
});

test('only the sections asked for are built', () => {
  const report = build({ sections: ['debts', 'fines'] });

  assert.deepEqual(report.sections, ['debts', 'fines']);
  assert.ok(report.debts && report.fines);
  assert.equal(report.position, null);
  assert.equal(report.thisWeek, null);
  assert.equal(report.extra, null);
  assert.equal(report.expenses, null);
  assert.deepEqual(
    report.glance.map(([label]) => label),
    ['Below the money line', 'Fines still owed'],
    'and the glance mentions only what the page carries'
  );
});

test('the glance states each section’s closing figure', () => {
  const glance = Object.fromEntries(build().glance);

  assert.equal(glance['Held by the group now'], 'Ksh 3,440,800');
  assert.equal(glance['Week 94 collected'], 'Ksh 4,200 of Ksh 7,000');
  assert.equal(glance['Below the money line'], '2 of 5 members, Ksh 4,500 short');
  assert.equal(glance['Above the money line'], '3 of 5 members, Ksh 5,300 over');
  assert.equal(glance['Fines still owed'], 'Ksh 1,800 by 2 members');
  assert.equal(glance['Spent (October 2026)'], 'Ksh 54,000 in 4 entries');
});

// --------------------------------------------------------------------------- expense periods

test('the expense periods are the group’s own week, month, or everything', () => {
  const weekStart = new Date('2026-10-09T00:00:00+03:00');
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

  const week = expensePeriod('week', { weekStart, weekEnd });
  assert.equal(week.from.getTime(), weekStart.getTime());
  assert.equal(week.to.getTime(), weekEnd.getTime());

  // 00:30 on 1 November in Nairobi is still 31 October in UTC: the month is the group's, not the server's.
  const month = expensePeriod('month', { weekStart, weekEnd, now: new Date('2026-10-31T21:30:00Z').getTime() });
  assert.equal(month.label, 'November 2026');
  assert.equal(month.from.toISOString(), '2026-10-31T21:00:00.000Z');
  assert.equal(month.to.toISOString(), '2026-11-30T20:59:59.999Z');

  const all = expensePeriod('all', { weekStart, weekEnd });
  assert.equal(all.from, null);
  assert.equal(all.to, null);
});

// -------------------------------------------------------------------------------------- the PDF

// What the page says, read back out of an uncompressed PDF: pdfkit writes each string of a standard
// font as hex inside a TJ array, so the page's text is the hex decoded.
function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  const out = [];
  for (const match of raw.matchAll(/\[((?:<[0-9a-fA-F]*>|\s|-?\d+(?:\.\d+)?)*)\]\s*TJ/g)) {
    let line = '';
    for (const hex of match[1].matchAll(/<([0-9a-fA-F]*)>/g)) {
      line += Buffer.from(hex[1], 'hex').toString('latin1');
    }
    out.push(line);
  }
  return out.join('\n');
}

async function render(report) {
  const headers = {};
  const sink = new PassThrough();
  sink.setHeader = (name, value) => {
    headers[name] = value;
  };
  const chunks = [];
  sink.on('data', (chunk) => chunks.push(chunk));
  renderMeetingReportPdf(sink, report, { compress: false });
  await new Promise((resolve) => sink.on('end', resolve));
  const buffer = Buffer.concat(chunks);
  return { headers, buffer, text: pdfText(buffer), pages: (buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length };
}

test('the PDF is written, named for the week, and carries every section with its total', async () => {
  const { headers, buffer, text } = await render(build());

  assert.equal(headers['Content-Type'], 'application/pdf');
  assert.match(headers['Content-Disposition'], /meeting-report-week-94\.pdf/);
  assert.match(buffer.toString('latin1'), /^%PDF-/);
  assert.match(buffer.toString('latin1'), /%%EOF/, 'finished, not truncated');

  // The group and the week it is for.
  assert.match(text, /Wazo Moja Self-Help Group/);
  assert.match(text, /Meeting report - week 94/);
  // Every section's heading.
  for (const heading of [
    'At a glance',
    'Where the money stands',
    "This week's collection - week 94",
    'Members below the line (debts)',
    'Members above the line (extra)',
    'Fines',
    'Expenses - October 2026',
  ]) {
    assert.ok(text.includes(heading), `missing heading: ${heading}`);
  }
  // The totals that close them — printed, not only computed.
  assert.ok(text.includes('Ksh 4,500'), 'debts total');
  assert.ok(text.includes('Ksh 5,300'), 'extra total');
  assert.ok(text.includes('Ksh 1,800'), 'fines owed');
  assert.ok(text.includes('Ksh 54,000'), 'spent');
  assert.ok(text.includes('Ksh 3,440,800'), 'held');
  // And the money line itself, with the member measured against it.
  assert.ok(text.includes('Ksh 117,400'), 'the line');
  assert.ok(text.includes('Brian (WM-0002)'));
  assert.ok(text.includes('Ksh 4,400'));
});

test('a section that was not asked for is not on the page', async () => {
  const { text } = await render(build({ sections: ['debts'] }));

  assert.ok(text.includes('Members below the line (debts)'));
  assert.ok(!text.includes('Where the money stands'));
  assert.ok(!text.includes('Expenses -'));
  assert.ok(!text.includes('Who owes what'));
});

test('the page explains a member who is under the line with nothing unpaid', async () => {
  const { text } = await render(build({ sections: ['debts'] }));
  assert.ok(text.includes('no closed week unpaid'), 'the note appears when it applies');

  const clean = await render(build({ sections: ['debts'], members: [member('Alice', LINE + 1)] }));
  assert.ok(clean.text.includes('Nobody is below the line.'));
  assert.ok(!clean.text.includes('no closed week unpaid'), 'and not when it does not');
});

test('with the money line off the page says there is nothing to measure against', async () => {
  const { text } = await render(build({ sections: ['debts', 'extra'], line: 0 }));
  assert.ok(text.includes('switched off'));
});

test('a long report runs onto more pages, each numbered, with the table header repeated', async () => {
  const many = Array.from({ length: 120 }, (_, i) => member(`Member ${String(i).padStart(3, '0')}`, LINE - 1000 - i, 1, `WM-${i}`));
  const report = build({ sections: ['debts'], members: many });
  const { text, pages } = await render(report);

  assert.ok(pages > 1, `120 rows should not fit one page, got ${pages}`);
  assert.ok(text.includes(`Page 1 of ${pages}`));
  assert.ok(text.includes(`Page ${pages} of ${pages}`));
  // Header row printed once per page the table runs over.
  const headers = text.split('\n').filter((line) => line === 'Below by').length;
  assert.equal(headers, pages, 'the column header is put back at the top of every page');
  assert.equal(report.debts.totals.count, 120);
});

test('a group with nothing to report still gets a page, not an error', async () => {
  const report = buildMeetingReport({
    chamaName: 'Wazo Moja Self-Help Group',
    week: WEEK,
    line: LINE,
    members: [],
    position: { ...POSITION, funds: [] },
    fines: { ...FINES, totals: { ...FINES.totals, count: 0, issued: 0, outstanding: 0, membersOwing: 0 }, byType: [], byMember: [] },
    expenses: [],
    period: PERIOD,
  });
  const { text, buffer } = await render(report);

  assert.match(buffer.toString('latin1'), /%%EOF/);
  assert.ok(text.includes('Nobody is below the line.'));
  assert.ok(text.includes('Nobody is above the line.'));
  assert.ok(text.includes('Nobody owes a fine'));
  assert.ok(text.includes('Nothing was spent in this period.'));
});
