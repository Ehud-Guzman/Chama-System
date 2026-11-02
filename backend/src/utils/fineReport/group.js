// The fines reports, part: group. utils/fineReport.js is the index everything else requires.

const PDFDocument = require('pdfkit');
const { CHAMA_NAME } = require('../../data/branding');
const { CONTENT_WIDTH, MARGIN, ensureRoom, sectionTitle, tableHeader } = require('./layout');
const { money, shortDate } = require('./format');

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(key) {
  const [year, month] = String(key).split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

// One fine, flattened once so every cut below (and every sheet) reads the same
// figures. `category` travels with it so a report can say whether a fine was a
// conduct matter or a financial one.
function mapFine(fine) {
  const amount = Number(fine.amount) || 0;
  const remaining = Number(fine.remaining) || 0;
  return {
    id: String(fine._id),
    date: fine.date,
    month: fine.date ? new Date(new Date(fine.date).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 7) : '',
    type: fine.typeId?.name || 'Fine',
    category: fine.typeId?.category || '',
    reason: fine.reason || '',
    amount,
    settled: amount - remaining,
    remaining,
    outstanding: remaining > 0,
    status: remaining > 0 ? 'Still owed' : 'Paid off',
    issuedBy: fine.issuedBy?.name || '',
    memberId: fine.memberId?._id ? String(fine.memberId._id) : String(fine.memberId || ''),
    memberName: fine.memberId?.name || 'Unknown',
    memberRegNumber: fine.memberId?.regNumber || '',
    memberPhone: fine.memberId?.phone || '',
    memberActive: fine.memberId?.active !== false,
    settlements: (fine.settlements || []).map((s) => ({
      date: s.date,
      amount: Number(s.amount) || 0,
    })),
  };
}

// The whole group's fines, in the four cuts a committee asks for: the totals, the
// fine types carrying the debt, who owes it, and how it has moved month by month.
function buildFineGroupReport({ fines, scopeLabel }) {
  const rows = fines.map(mapFine);

  const byTypeMap = new Map();
  const byMemberMap = new Map();
  const byMonthMap = new Map();

  for (const row of rows) {
    const type = byTypeMap.get(row.type) || {
      name: row.type,
      category: row.category,
      issued: 0,
      outstanding: 0,
      count: 0,
    };
    type.issued += row.amount;
    type.outstanding += row.remaining;
    type.count += 1;
    byTypeMap.set(row.type, type);

    const member = byMemberMap.get(row.memberId) || {
      memberId: row.memberId,
      name: row.memberName,
      regNumber: row.memberRegNumber,
      phone: row.memberPhone,
      active: row.memberActive,
      issued: 0,
      outstanding: 0,
      fines: 0,
      // The two questions the office asks straight after "who owes what": how long has
      // he owed it, and what for. Both are answered from the rows already in hand, so
      // the list can say "owing since 12 Mar" and open up a member's own breakdown
      // without a second request.
      oldestUnpaid: null,
      newestUnpaid: null,
      types: [],
    };
    member.issued += row.amount;
    member.outstanding += row.remaining;
    member.fines += 1;

    if (row.outstanding) {
      const at = row.date ? new Date(row.date) : null;
      const dated = at && !Number.isNaN(at.getTime()) ? at : null;
      if (dated) {
        if (!member.oldestUnpaid || dated < member.oldestUnpaid) member.oldestUnpaid = dated;
        if (!member.newestUnpaid || dated > member.newestUnpaid) member.newestUnpaid = dated;
      }

      // What he owes, by fine type. The biggest line first, so the row reads as its own
      // little statement of account rather than a second list to work through.
      const owing = member.types.find((t) => t.name === row.type && t.category === row.category);
      if (owing) {
        owing.outstanding += row.remaining;
        owing.count += 1;
        if (dated && (!owing.oldest || dated < owing.oldest)) owing.oldest = dated;
      } else {
        member.types.push({
          name: row.type,
          category: row.category,
          outstanding: row.remaining,
          count: 1,
          oldest: dated,
        });
      }
    }

    byMemberMap.set(row.memberId, member);

    if (row.month) {
      const month = byMonthMap.get(row.month) || { month: row.month, issued: 0, outstanding: 0, count: 0 };
      month.issued += row.amount;
      month.outstanding += row.remaining;
      month.count += 1;
      byMonthMap.set(row.month, month);
    }
  }

  const issued = rows.reduce((sum, r) => sum + r.amount, 0);
  const outstanding = rows.reduce((sum, r) => sum + r.remaining, 0);
  const dates = rows.map((r) => new Date(r.date).getTime()).filter((t) => !Number.isNaN(t));
  // The debts that are still standing, separately from every fine ever issued: "oldest
  // owed" is the line a meeting reacts to, and it is not the same as the oldest fine.
  const unpaidDates = rows
    .filter((r) => r.outstanding)
    .map((r) => new Date(r.date).getTime())
    .filter((t) => !Number.isNaN(t));

  return {
    scopeLabel: scopeLabel || 'Fines',
    rows,
    totals: {
      count: rows.length,
      issued,
      outstanding,
      cleared: issued - outstanding,
      pendingCount: rows.filter((r) => r.outstanding).length,
      clearedCount: rows.filter((r) => !r.outstanding).length,
      membersOwing: [...byMemberMap.values()].filter((m) => m.outstanding > 0).length,
      firstDate: dates.length ? new Date(Math.min(...dates)) : null,
      lastDate: dates.length ? new Date(Math.max(...dates)) : null,
      oldestUnpaid: unpaidDates.length ? new Date(Math.min(...unpaidDates)) : null,
      newestUnpaid: unpaidDates.length ? new Date(Math.max(...unpaidDates)) : null,
    },
    byType: [...byTypeMap.values()].sort((a, b) => b.outstanding - a.outstanding || b.issued - a.issued),
    byMember: [...byMemberMap.values()]
      // Each member's own types, biggest line first, so the breakdown reads top-down.
      .map((m) => ({ ...m, types: [...m.types].sort((a, b) => b.outstanding - a.outstanding) }))
      .filter((m) => m.fines > 0)
      .sort((a, b) => b.outstanding - a.outstanding || b.issued - a.issued || a.name.localeCompare(b.name)),
    byMonth: [...byMonthMap.values()].sort((a, b) => (a.month < b.month ? 1 : -1)),
    generatedAt: new Date(),
  };
}

function slugOf(value) {
  return String(value || 'group').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// The group's side of the same story, as a PDF: the totals, which fine types carry
// the debt, who owes it (the biggest debtors first, because that is the list a
// meeting works down), and how it has moved month by month.
function renderFineGroupReportPdf(res, report, chamaName) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="fines-${slugOf(report.scopeLabel)}.pdf"`
  );

  const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(17).text(chamaName || CHAMA_NAME);
  doc.font('Helvetica').fontSize(10).fillColor('#666').text(`${report.scopeLabel} - group record`);
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(9).fillColor('#888');
  doc.text(
    `Generated ${shortDate(report.generatedAt)}${report.preparedBy ? ` by ${report.preparedBy}` : ''}`
  );
  doc.moveDown(0.8);
  doc.fillColor('#000');

  const t = report.totals;

  // ---------------------------------------------------------------- totals
  let y = sectionTitle(doc, doc.y, 'Where the group stands');
  const lines = [
    ['Fines on record', String(t.count)],
    ['Issued in total', money(t.issued)],
    ['Paid off', `${money(t.cleared)} (${t.clearedCount} fines)`],
    ['Still owed', `${money(t.outstanding)} (${t.pendingCount} fines)`],
    ['Members owing', String(t.membersOwing)],
    ['Period covered', t.firstDate ? `${shortDate(t.firstDate)} - ${shortDate(t.lastDate)}` : '-'],
  ];
  for (const [label, value] of lines) {
    y = ensureRoom(doc, y, 14);
    doc.font('Helvetica').fontSize(9);
    doc.text(label, MARGIN, y, { width: 250 });
    doc.text(value, MARGIN + 250, y, { width: 245, align: 'right' });
    y += 14;
  }
  y += 8;

  // ---------------------------------------------------------------- by type
  if (report.byType.length > 0) {
    const cols = [
      { key: 'name', label: 'Fine type', x: MARGIN, width: 200 },
      { key: 'category', label: 'Category', x: MARGIN + 205, width: 90 },
      { key: 'count', label: 'Fines', x: MARGIN + 300, width: 55, align: 'right' },
      { key: 'issued', label: 'Issued', x: MARGIN + 360, width: 70, align: 'right' },
      { key: 'outstanding', label: 'Owed', x: MARGIN + 435, width: 60, align: 'right' },
    ];
    y = sectionTitle(doc, y, 'By fine type');
    y = tableHeader(doc, y, cols);
    for (const row of report.byType) {
      y = ensureRoom(doc, y, 14, cols);
      doc.font('Helvetica').fontSize(9);
      doc.text(row.name, cols[0].x, y, { width: cols[0].width });
      doc.text(row.category, cols[1].x, y, { width: cols[1].width });
      doc.text(String(row.count), cols[2].x, y, { width: cols[2].width, align: 'right' });
      doc.text(money(row.issued), cols[3].x, y, { width: cols[3].width, align: 'right' });
      doc.fillColor(row.outstanding > 0 ? '#b3261e' : '#000');
      doc.text(money(row.outstanding), cols[4].x, y, { width: cols[4].width, align: 'right' });
      doc.fillColor('#000');
      y += 14;
    }
    y += 8;
  }

  // -------------------------------------------------------------- by member
  const owing = report.byMember.filter((m) => m.outstanding > 0);
  y = sectionTitle(doc, y, owing.length > 0 ? 'Who owes what' : 'Nobody owes a fine');
  if (owing.length > 0) {
    const cols = [
      { key: 'name', label: 'Member', x: MARGIN, width: 250 },
      { key: 'reg', label: 'Reg no', x: MARGIN + 255, width: 80 },
      { key: 'fines', label: 'Fines', x: MARGIN + 340, width: 55, align: 'right' },
      { key: 'outstanding', label: 'Owed', x: MARGIN + 400, width: 95, align: 'right' },
    ];
    y = tableHeader(doc, y, cols);
    for (const row of owing.slice(0, 40)) {
      y = ensureRoom(doc, y, 14, cols);
      doc.font('Helvetica').fontSize(9);
      doc.text(`${row.name}${row.active === false ? ' (resigned)' : ''}`, cols[0].x, y, {
        width: cols[0].width,
      });
      doc.text(row.regNumber || '', cols[1].x, y, { width: cols[1].width });
      doc.text(String(row.fines), cols[2].x, y, { width: cols[2].width, align: 'right' });
      doc.fillColor('#b3261e');
      doc.text(money(row.outstanding), cols[3].x, y, { width: cols[3].width, align: 'right' });
      doc.fillColor('#000');
      y += 14;
    }
    if (owing.length > 40) {
      y += 2;
      doc.font('Helvetica').fontSize(8).fillColor('#666');
      doc.text(`Showing the 40 largest of ${owing.length} members owing.`, MARGIN, y);
      doc.fillColor('#000');
      y = doc.y + 4;
    }
    y += 8;
  }

  // --------------------------------------------------------------- by month
  if (report.byMonth.length > 0) {
    const cols = [
      { key: 'month', label: 'Month', x: MARGIN, width: 150 },
      { key: 'count', label: 'Fines', x: MARGIN + 160, width: 80, align: 'right' },
      { key: 'issued', label: 'Issued', x: MARGIN + 250, width: 110, align: 'right' },
      { key: 'outstanding', label: 'Still owed', x: MARGIN + 370, width: 125, align: 'right' },
    ];
    y = sectionTitle(doc, y, 'Month by month');
    y = tableHeader(doc, y, cols);
    for (const row of report.byMonth) {
      y = ensureRoom(doc, y, 14, cols);
      doc.font('Helvetica').fontSize(9);
      doc.text(monthLabel(row.month), cols[0].x, y, { width: cols[0].width });
      doc.text(String(row.count), cols[1].x, y, { width: cols[1].width, align: 'right' });
      doc.text(money(row.issued), cols[2].x, y, { width: cols[2].width, align: 'right' });
      doc.text(money(row.outstanding), cols[3].x, y, { width: cols[3].width, align: 'right' });
      y += 14;
    }
  }

  y = ensureRoom(doc, y + 10, 36);
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').stroke();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#666')
    .text(
      'Taken from the group\u2019s own fine records. Voided fines are not counted here - they ' +
        'were issued and then cancelled, so nothing is owed on them.',
      MARGIN,
      y + 8,
      { width: CONTENT_WIDTH }
    );

  doc.end();
}

// The same group report as a workbook: one sheet per cut, plus every fine in a
// sheet of its own so nothing in the totals has to be taken on trust.
function fineGroupReportSheets(report, chamaName) {
  const t = report.totals;

  const aboutRows = [
    { Field: 'Chama', Value: chamaName || '' },
    { Field: 'Report', Value: `${report.scopeLabel} - group record` },
    { Field: 'Generated on', Value: report.generatedAt },
    { Field: 'Prepared by', Value: report.preparedBy || '' },
    {
      Field: 'Period covered',
      Value: t.firstDate ? `${shortDate(t.firstDate)} - ${shortDate(t.lastDate)}` : '',
    },
    {
      Field: 'What this counts',
      Value:
        'Every fine issued and not voided. A fine stays outstanding until it is fully paid; ' +
        '"paid off" is the amount collected against it.',
    },
  ];

  const totalRows = [
    { Field: 'Fines on record', Value: t.count },
    { Field: 'Issued in total', Value: t.issued },
    { Field: 'Paid off', Value: t.cleared },
    { Field: 'Still owed', Value: t.outstanding },
    { Field: 'Fines not cleared', Value: t.pendingCount },
    { Field: 'Fines cleared', Value: t.clearedCount },
    { Field: 'Members owing', Value: t.membersOwing },
  ];

  const memberRows = report.byMember.map((m) => ({
    Member: m.name,
    'Reg number': m.regNumber,
    Phone: m.phone,
    Status: m.active === false ? 'Resigned' : 'Active',
    Fines: m.fines,
    Issued: m.issued,
    'Still owed': m.outstanding,
  }));

  const typeRows = report.byType.map((row) => ({
    'Fine type': row.name,
    Category: row.category,
    Fines: row.count,
    Issued: row.issued,
    'Still owed': row.outstanding,
  }));

  const monthRows = report.byMonth.map((row) => ({
    Month: monthLabel(row.month),
    Fines: row.count,
    Issued: row.issued,
    'Still owed': row.outstanding,
  }));

  const fineRows = report.rows
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((row) => ({
      Date: row.date,
      Member: row.memberName,
      'Reg number': row.memberRegNumber,
      Fine: row.type,
      Category: row.category,
      Reason: row.reason,
      Issued: row.amount,
      Paid: row.settled,
      'Still owed': row.remaining,
      Status: row.status,
      'Issued by': row.issuedBy,
    }));

  return [
    { name: 'About this export', rows: aboutRows },
    { name: 'Totals', rows: totalRows },
    { name: 'By member', rows: memberRows },
    { name: 'By fine type', rows: typeRows },
    { name: 'By month', rows: monthRows },
    { name: 'All fines', rows: fineRows },
  ];
}

module.exports = {
  buildFineGroupReport,
  fineGroupReportSheets,
  renderFineGroupReportPdf,
};
