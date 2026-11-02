// The meeting report, part: sections. utils/meetingReport.js is the index everything else requires.

const { GREEN, RED, caption, drawTable, figureLines, nameCell, sectionTitle } = require('./layout');
const { money, plural, shortDate } = require('./format');

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

module.exports = {
  renderDebts,
  renderExpenses,
  renderExtra,
  renderFines,
  renderGlance,
  renderPosition,
  renderWeek,
};
