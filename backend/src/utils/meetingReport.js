const PDFDocument = require('pdfkit');
const { CHAMA_NAME } = require('../data/branding');
const { toMoney } = require('./money');
const { coveredByBalance } = require('./reminderLimit');
const { mapExpense } = require('./expenseReport');

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

// ------------------------------------------------------------------------------------- the PDF

const numberFmt = new Intl.NumberFormat('en-KE');
function money(amount) {
  return `Ksh ${numberFmt.format(Number(amount) || 0)}`;
}
// In the group's own timezone, not the server's: a week starts at midnight Nairobi time, which is the
// evening before on a host that runs on UTC, and the page would print the Thursday as the Wednesday.
function shortDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Nairobi',
  });
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The page is set in the PDF's built-in Helvetica, which can draw Western-European text (the Latin-1
// letters and the usual punctuation) and nothing else. A character outside that is not skipped: it is
// drawn as some other, wrong glyph ("Ngũgĩ" came out as "¦qig"), which on a page of names and money is
// worse than an honest substitute. So the plain letter stands in (ũ -> u), and what cannot be
// drawn at all (another script, an emoji) becomes "?".
const CP1252_EXTRAS = new Set(
  '‘’‚“”„†‡•…‰‹›€™' +
    '–—ŒœŠšŸŽžƒˆ˜'
);
const LETTER_FALLBACKS = { Ŋ: 'N', ŋ: 'n' };
function printable(value) {
  if (typeof value !== 'string') return value;
  let out = '';
  // for..of walks code points, so an emoji is one character to replace, not two broken halves.
  for (const char of value) {
    const code = char.codePointAt(0);
    if (((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) || CP1252_EXTRAS.has(char) || code === 10) {
      out += char;
      continue;
    }
    const plain = LETTER_FALLBACKS[char] || char.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += plain.length > 0 && [...plain].every((c) => c.codePointAt(0) <= 0xff) ? plain : '?';
  }
  return out;
}

const MARGIN = 50;
const CONTENT_WIDTH = 495;
const RED = '#b3261e';
const GREEN = '#166534';
const GREY = '#666';

// Lays columns out left to right from their widths, with a small gap between them. The first column
// (the name, the fund, the date — the one that holds words) takes whatever width the others leave,
// so every table runs the full width of the page and its right-hand figures line up under the rule.
function layoutColumns(cols) {
  const gap = 6;
  const used = cols.reduce((total, col) => total + col.width, 0) + gap * (cols.length - 1);
  const slack = Math.max(0, CONTENT_WIDTH - used);
  let x = MARGIN;
  return cols.map((col, i) => {
    const width = i === 0 ? col.width + slack : col.width;
    const placed = { ...col, width, x };
    x += width + gap;
    return placed;
  });
}

function pageBottom(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

function tableHeader(doc, y, cols) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#444');
  for (const col of cols) {
    doc.text(col.label, col.x, y, { width: col.width, align: col.align || 'left' });
  }
  doc.moveTo(MARGIN, y + 14).lineTo(MARGIN + CONTENT_WIDTH, y + 14).strokeColor('#ccc').stroke();
  doc.font('Helvetica').fillColor('#000');
  return y + 20;
}

// Starts a new page when `needed` points will not fit, and puts a table's header back at the top of
// it, so a row that runs over the page is still under a heading somebody can read.
function ensureRoom(doc, y, needed, cols) {
  if (y + needed <= pageBottom(doc)) return y;
  doc.addPage();
  return cols ? tableHeader(doc, MARGIN, cols) : MARGIN;
}

// A heading needs room for something under it as well: left alone at the foot of a page it heads
// nothing, and the table it belongs to starts on the next one.
function sectionTitle(doc, y, title) {
  y = ensureRoom(doc, y, 110);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(RED).text(title, MARGIN, y, { width: CONTENT_WIDTH });
  doc.fillColor('#000').font('Helvetica');
  return y + 18;
}

// A paragraph of small grey explanation under a title: what the figures below are, so a page handed
// to somebody who was not at the meeting still says what it means.
function caption(doc, y, text) {
  doc.font('Helvetica').fontSize(8);
  const height = doc.heightOfString(text, { width: CONTENT_WIDTH });
  y = ensureRoom(doc, y, height + 6);
  doc.fillColor(GREY).text(text, MARGIN, y, { width: CONTENT_WIDTH });
  doc.fillColor('#000');
  return y + height + 6;
}

// A label on the left, its figure on the right.
function figureLines(doc, y, lines) {
  for (const [label, value, color] of lines) {
    y = ensureRoom(doc, y, 14);
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    doc.text(label, MARGIN, y, { width: 290 });
    doc.fillColor(color || '#000').font('Helvetica-Bold');
    doc.text(value, MARGIN + 290, y, { width: CONTENT_WIDTH - 290, align: 'right' });
    doc.fillColor('#000').font('Helvetica');
    y += 14;
  }
  return y + 4;
}

// A table, with a total row that closes it. Cells wrap rather than clip — a voucher description cut
// short on a financial page is information lost — so each row is as tall as its tallest cell, and a
// row's optional `sub` line sits under it in small grey type.
function drawTable(doc, y, columns, rows, { total = null, emptyText = '' } = {}) {
  const cols = layoutColumns(columns);
  y = ensureRoom(doc, y, 60);
  y = tableHeader(doc, y, cols);

  if (rows.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor(GREY).text(emptyText, MARGIN, y, { width: CONTENT_WIDTH });
    doc.fillColor('#000');
    return doc.y + 8;
  }

  for (const row of rows) {
    doc.font('Helvetica').fontSize(9);
    const cells = cols.map((col) => String(col.get(row) ?? ''));
    const cellHeights = cells.map((text, i) => doc.heightOfString(text, { width: cols[i].width }));
    let height = Math.max(...cellHeights, 11);
    let subHeight = 0;
    if (row.sub) {
      doc.fontSize(8);
      subHeight = doc.heightOfString(row.sub, { width: CONTENT_WIDTH });
      doc.fontSize(9);
    }
    const needed = height + subHeight + (row.sub ? 1 : 0) + 4;
    y = ensureRoom(doc, y, needed, cols);

    cols.forEach((col, i) => {
      doc.fillColor(col.color ? col.color(row) || '#000' : '#000');
      doc.text(cells[i], col.x, y, { width: col.width, align: col.align || 'left' });
    });
    doc.fillColor('#000');
    y += height;
    if (row.sub) {
      doc.font('Helvetica').fontSize(8).fillColor(GREY).text(row.sub, MARGIN, y + 1, { width: CONTENT_WIDTH });
      doc.fillColor('#000');
      y += subHeight + 1;
    }
    y += 4;
  }

  if (total) {
    y = ensureRoom(doc, y, 22, cols);
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#888').stroke();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(9);
    for (const col of cols) {
      const text = col.total ? String(col.total(total) ?? '') : '';
      if (text) doc.text(text, col.x, y, { width: col.width, align: col.align || 'left' });
    }
    doc.font('Helvetica');
    y += 16;
  }
  return y + 6;
}

const nameCell = (r) => `${r.name}${r.regNumber ? ` (${r.regNumber})` : ''}`;

function renderGlance(doc, y, report) {
  y = sectionTitle(doc, y, 'At a glance');
  return figureLines(doc, y, report.glance);
}

function renderPosition(doc, y, p) {
  y = sectionTitle(doc, y, 'Where the money stands');
  y = figureLines(doc, y, [
    ['Money in, all time (members and funds)', money(p.moneyIn)],
    ['   carried in from the paper ledger', money(p.carriedIn)],
    ['   paid in since the books opened', money(p.paidIn)],
    ['Spent (loans and advances excluded)', money(p.spent), p.spent > 0 ? RED : null],
    ['   out of the funds the group collects into', money(p.spentFromFunds)],
    ["   out of the group's total money (no fund)", money(p.spentFromGroupTotal)],
    ['Held by the group now (everything in, less everything spent)', money(p.held)],
    ["Cash collected from fines (kept out of the figures above)", money(p.finesCollected)],
  ]);

  if (p.funds.length > 0) {
    y = drawTable(
      doc,
      y,
      [
        {
          label: 'Fund',
          width: 205,
          get: (r) => r.name + (r.isRecoverable ? ' (loan fund)' : ''),
          total: () => 'All funds',
        },
        { label: 'In', width: 90, align: 'right', get: (r) => money(r.in), total: (t) => money(t.in) },
        { label: 'Out', width: 90, align: 'right', get: (r) => money(r.out), total: (t) => money(t.out) },
        {
          label: 'Holds now',
          width: 90,
          align: 'right',
          get: (r) => money(r.holds),
          color: (r) => (r.holds < 0 ? RED : null),
          total: (t) => money(t.holds),
        },
      ],
      p.funds,
      { total: { ...p.fundTotals, label: 'All funds' } }
    );
    if (p.fundTotals.onLoan > 0) {
      y = caption(
        doc,
        y - 4,
        `${money(p.fundTotals.onLoan)} of the money out of the funds is a loan or advance still owed back to them.`
      );
    }
  }
  return y;
}

function renderWeek(doc, y, w) {
  y = sectionTitle(doc, y, `This week's collection - week ${w.weekNumber}`);
  y = caption(
    doc,
    y,
    `${shortDate(w.startDate)} to ${shortDate(w.endDate)}. The week asks ${money(w.weeklyAmount)} from each of ` +
      `the ${w.members} active members; tea and the other funds are collected alongside it, not instead of it.`
  );
  return figureLines(doc, y, [
    ['The week asks for', money(w.expected)],
    ['Paid in so far', money(w.paid)],
    ['Still to come', money(w.shortfall), w.shortfall > 0 ? RED : GREEN],
    ['Share collected', `${w.percent}%`],
    [`Members who brought the whole ${money(w.weeklyAmount)}`, `${w.paidCount} of ${w.members}`],
    ['Members part-paid', String(w.partialCount)],
    ['Members yet to pay anything', String(w.noneCount), w.noneCount > 0 ? RED : null],
  ]);
}

function lineCaption(line, weekNumber) {
  return (
    `The money line for week ${weekNumber} is ${money(line)}. It is the group's own figure (Settings > Reminders) ` +
    'and rises with the collection each week. "Holds" is the money the group is keeping for the member: ' +
    'what he carried in, plus what he has paid in, less the tea and any fines that came off it.'
  );
}

function renderDebts(doc, y, d, weekNumber) {
  y = sectionTitle(doc, y, 'Members below the line (debts)');
  if (d.off) {
    return caption(
      doc,
      y,
      'The money line is switched off (Settings > Reminders), so there is no line to measure the members against.'
    );
  }
  y = caption(doc, y, lineCaption(d.line, weekNumber));
  y = drawTable(
    doc,
    y,
    [
      {
        label: 'Member',
        width: 210,
        get: nameCell,
        total: (t) => `${t.count} of ${plural(t.members, 'member', 'members')}`,
      },
      { label: 'Holds', width: 85, align: 'right', get: (r) => money(r.held) },
      {
        label: 'Below by',
        width: 85,
        align: 'right',
        get: (r) => money(r.short),
        color: () => RED,
        total: (t) => money(t.total),
      },
      {
        label: 'Unpaid weeks',
        width: 80,
        align: 'right',
        get: (r) => String(r.weeksUnpaid || 0),
      },
    ],
    d.rows,
    { total: d.totals, emptyText: 'Nobody is below the line.' }
  );
  if (d.totals.noUnpaidWeek > 0) {
    y = caption(
      doc,
      y - 4,
      `${plural(d.totals.noUnpaidWeek, 'member', 'members')} below the line ` +
        `${d.totals.noUnpaidWeek === 1 ? 'has' : 'have'} no closed week unpaid. The line already counts ` +
        "the week now running, so a member who has not yet brought this week's contribution sits below " +
        'it until he does, and fines paid out of what he holds also lower it.'
    );
  }
  return y;
}

function renderExtra(doc, y, e, weekNumber) {
  y = sectionTitle(doc, y, 'Members above the line (extra)');
  if (e.off) {
    return caption(
      doc,
      y,
      'The money line is switched off (Settings > Reminders), so there is no line to measure the members against.'
    );
  }
  y = caption(
    doc,
    y,
    `${lineCaption(e.line, weekNumber)} A member exactly on the line counts as above it, with nothing extra.`
  );
  return drawTable(
    doc,
    y,
    [
      {
        label: 'Member',
        width: 255,
        get: nameCell,
        total: (t) => `${t.count} of ${plural(t.members, 'member', 'members')}`,
      },
      { label: 'Holds', width: 95, align: 'right', get: (r) => money(r.held) },
      {
        label: 'Above by',
        width: 95,
        align: 'right',
        get: (r) => money(r.extra),
        color: () => GREEN,
        total: (t) => money(t.total),
      },
    ],
    e.rows,
    { total: e.totals, emptyText: 'Nobody is above the line.' }
  );
}

function renderFines(doc, y, f) {
  const t = f.totals;
  y = sectionTitle(doc, y, 'Fines');
  y = figureLines(doc, y, [
    ['Fines on record (not voided)', String(t.count)],
    ['Issued in total', money(t.issued)],
    ['Paid off', `${money(t.cleared)} (${plural(t.clearedCount, 'fine', 'fines')})`, GREEN],
    ['Still owed', `${money(t.outstanding)} (${plural(t.pendingCount, 'fine', 'fines')})`, t.outstanding > 0 ? RED : null],
    ['Members owing', String(t.membersOwing)],
    ['Oldest debt still standing', t.oldestUnpaid ? shortDate(t.oldestUnpaid) : '-'],
  ]);

  if (f.byType.length > 0) {
    y = drawTable(
      doc,
      y,
      [
        { label: 'Fine type', width: 200, get: (r) => r.name, total: () => 'Total' },
        { label: 'Category', width: 85, get: (r) => r.category || '' },
        { label: 'Fines', width: 45, align: 'right', get: (r) => String(r.count), total: (x) => String(x.count) },
        { label: 'Issued', width: 70, align: 'right', get: (r) => money(r.issued), total: (x) => money(x.issued) },
        {
          label: 'Owed',
          width: 65,
          align: 'right',
          get: (r) => money(r.outstanding),
          color: (r) => (r.outstanding > 0 ? RED : null),
          total: (x) => money(x.outstanding),
        },
      ],
      f.byType,
      { total: { count: t.count, issued: t.issued, outstanding: t.outstanding } }
    );
  }

  y = sectionTitle(doc, y, f.byMember.length > 0 ? 'Who owes what' : 'Nobody owes a fine');
  if (f.byMember.length > 0) {
    y = drawTable(
      doc,
      y,
      [
        {
          label: 'Member',
          width: 225,
          get: (r) => `${nameCell(r)}${r.active === false ? ' - resigned' : ''}`,
          total: () => `${f.byMember.length} member${f.byMember.length === 1 ? '' : 's'}`,
        },
        { label: 'Owing since', width: 85, get: (r) => shortDate(r.oldestUnpaid) },
        { label: 'Fines', width: 45, align: 'right', get: (r) => String(r.fines), total: () => String(f.finesListed) },
        {
          label: 'Owed',
          width: 80,
          align: 'right',
          get: (r) => money(r.outstanding),
          color: () => RED,
          total: () => money(f.owedByListed),
        },
      ],
      // What each is owed for, under the name: "who owes what" always leads to "what for".
      f.byMember.map((m) => ({
        ...m,
        sub: (m.types || []).map((x) => `${x.name} (${x.count})`).join('  ·  '),
      })),
      { total: {} }
    );
    if (f.truncated) {
      y = caption(
        doc,
        y - 4,
        `Showing the ${f.limit} largest debts; more members than that owe a fine. The fines export carries every one.`
      );
    }
  }
  return y;
}

function renderExpenses(doc, y, e) {
  y = sectionTitle(doc, y, `Expenses - ${e.period.label}`);
  if (e.period.from && e.period.to) {
    y = caption(doc, y, `${shortDate(e.period.from)} to ${shortDate(e.period.to)}.`);
  }
  y = figureLines(doc, y, [
    ['Entries', String(e.totals.count)],
    ['Spent (loans and advances excluded)', money(e.totals.spent), e.totals.spent > 0 ? RED : null],
    ['Loans and advances, still owed back', money(e.totals.owedBack)],
    ['Total listed', money(e.totals.total)],
  ]);

  if (e.byFund.length > 0) {
    y = drawTable(
      doc,
      y,
      [
        { label: 'Fund', width: 285, get: (r) => r.name + (r.recoverable ? ' (loan)' : ''), total: () => 'Total' },
        { label: 'Entries', width: 80, align: 'right', get: (r) => String(r.count), total: (t) => String(t.count) },
        { label: 'Amount', width: 110, align: 'right', get: (r) => money(r.amount), total: (t) => money(t.total) },
      ],
      e.byFund,
      { total: e.totals }
    );
  }

  return drawTable(
    doc,
    y,
    [
      { label: 'Date', width: 62, get: (r) => shortDate(r.date) },
      {
        label: 'Fund',
        width: 100,
        get: (r) => r.fund + (r.recoverable ? ' (loan)' : ''),
        total: () => 'Total listed',
      },
      { label: 'What it was for', width: 185, get: (r) => r.description || '-' },
      { label: 'Voucher', width: 55, get: (r) => r.reference || '-' },
      {
        label: 'Amount',
        width: 70,
        align: 'right',
        get: (r) => money(r.amount),
        total: (t) => money(t.total),
      },
    ],
    // A note is part of the record of what the money was for; who typed the entry in is not
    // something a meeting wants repeated under every line (the spending report carries it).
    e.rows.map((r) => ({ ...r, sub: r.note ? `Note: ${r.note}` : '' })),
    { total: e.totals, emptyText: 'Nothing was spent in this period.' }
  );
}

// The report as a PDF, built whole. `compress: false` is for the tests, which read the page's own text.
//
// Built into memory rather than streamed to the response: a failure part-way through a stream arrives
// after the 200 and the headers have gone, and the office would be handed a truncated file that opens
// as a damaged page. Built first, a failure is an ordinary error response and nothing was sent.
function buildPdfBuffer(report, { compress = true } = {}) {
  const weekNumber = report.week ? report.week.number : '';
  return new Promise((resolve, reject) => {
    // Buffered, so every page can be numbered once the last one is known.
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4', bufferPages: true, compress });
    // Every string the page draws or measures goes through `printable`, so no member's name, fine
    // reason or voucher note can reach the PDF as a glyph the font does not have.
    const drawText = doc.text.bind(doc);
    const measureText = doc.heightOfString.bind(doc);
    doc.text = (text, ...args) => drawText(printable(text), ...args);
    doc.heightOfString = (text, ...args) => measureText(printable(text), ...args);
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      drawReport(doc, report, weekNumber);
    } catch (err) {
      reject(err);
    }
  });
}

// Sends the report. Resolves once it has been handed to `res`; rejects, with nothing sent, if the
// document could not be built.
async function renderMeetingReportPdf(res, report, options) {
  const weekNumber = report.week ? report.week.number : '';
  const pdf = await buildPdfBuffer(report, options);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="meeting-report${weekNumber ? `-week-${weekNumber}` : ''}.pdf"`
  );
  res.end(pdf);
}

function drawReport(doc, report, weekNumber) {
  doc.font('Helvetica-Bold').fontSize(17).fillColor('#000').text(report.chamaName);
  doc.font('Helvetica').fontSize(10).fillColor(GREY).text(
    `Meeting report${weekNumber ? ` - week ${weekNumber}` : ''}`
  );
  doc.fontSize(9).fillColor('#888').text(
    `${report.week ? `${shortDate(report.week.startDate)} to ${shortDate(report.week.endDate)}  ·  ` : ''}` +
      `Prepared ${shortDate(report.generatedAt)}${report.preparedBy ? ` by ${report.preparedBy}` : ''}`
  );
  doc.moveDown(0.8);
  doc.fillColor('#000');

  let y = renderGlance(doc, doc.y, report);

  if (report.position) y = renderPosition(doc, y, report.position);
  if (report.thisWeek) y = renderWeek(doc, y, report.thisWeek);
  if (report.debts) y = renderDebts(doc, y, report.debts, weekNumber);
  if (report.extra) y = renderExtra(doc, y, report.extra, weekNumber);
  if (report.fines) y = renderFines(doc, y, report.fines);
  if (report.expenses) y = renderExpenses(doc, y, report.expenses);

  // The footer, on every page: which page of how many, so a loose sheet can be put back in order.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Written inside the bottom margin, which pdfkit would otherwise answer with a new page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#888')
      .text(
        `${report.chamaName}  ·  Meeting report${weekNumber ? `, week ${weekNumber}` : ''}  ·  Page ${i + 1} of ${range.count}`,
        MARGIN,
        doc.page.height - 34,
        { width: CONTENT_WIDTH, align: 'center', lineBreak: false }
      );
    doc.page.margins.bottom = bottom;
  }

  doc.end();
}

module.exports = {
  SECTIONS,
  SECTION_KEYS,
  EXPENSE_ROLES,
  EXPENSE_PERIODS,
  parseSections,
  expensePeriod,
  splitByLine,
  buildMeetingReport,
  printable,
  buildPdfBuffer,
  renderMeetingReportPdf,
};
