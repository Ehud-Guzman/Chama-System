const PDFDocument = require('pdfkit');

// One member's fines, in full: what was issued, what has been paid off, what is
// still owed, and — kept deliberately — what was issued and later voided, because
// a report that quietly drops a wrong fine cannot be checked against the minutes
// that ordered it.
//
// Written for the disciplinary officer as much as for the office: he issues these
// fines, he is asked about them in a meeting, and until now the only record he
// could hand over was a screen.

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

// Everything both the PDF and the workbook print, in one place.
function buildFineReport({ member, fines, voidedFines = [], scopeLabel }) {
  const rows = fines.map((fine) => {
    const amount = Number(fine.amount) || 0;
    const remaining = Number(fine.remaining) || 0;
    const settlements = (fine.settlements || []).map((s) => ({
      date: s.date,
      amount: Number(s.amount) || 0,
    }));
    return {
      id: String(fine._id),
      date: fine.date,
      type: fine.typeId?.name || 'Fine',
      category: fine.typeId?.category || '',
      reason: fine.reason || '',
      amount,
      settled: amount - remaining,
      remaining,
      outstanding: remaining > 0,
      status: remaining > 0 ? 'Outstanding' : 'Cleared',
      issuedBy: fine.issuedBy?.name || '',
      settlements,
    };
  });

  const voided = voidedFines.map((fine) => ({
    id: String(fine._id),
    date: fine.date,
    type: fine.typeId?.name || 'Fine',
    reason: fine.reason || '',
    amount: Number(fine.amount) || 0,
    issuedBy: fine.issuedBy?.name || '',
  }));

  const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);
  const settledAmount = rows.reduce((sum, r) => sum + r.settled, 0);
  const outstanding = rows.reduce((sum, r) => sum + r.remaining, 0);
  const dates = rows.map((r) => new Date(r.date).getTime()).filter((t) => !Number.isNaN(t));

  return {
    member: {
      name: member.name || '',
      regNumber: member.regNumber || '',
      phone: member.phone || '',
      active: member.active !== false,
      joinDate: member.joinDate || member.createdAt || null,
    },
    scopeLabel: scopeLabel || 'Fines',
    rows,
    voided,
    summary: {
      count: rows.length,
      outstandingCount: rows.filter((r) => r.outstanding).length,
      clearedCount: rows.filter((r) => !r.outstanding).length,
      voidedCount: voided.length,
      totalAmount,
      settledAmount,
      outstanding,
      firstDate: dates.length ? new Date(Math.min(...dates)) : null,
      lastDate: dates.length ? new Date(Math.max(...dates)) : null,
      settlements: rows.reduce((sum, r) => sum + r.settlements.length, 0),
    },
    generatedAt: new Date(),
  };
}

const MARGIN = 50;
const CONTENT_WIDTH = 495;

const FINE_COLS = [
  { key: 'date', label: 'Date', x: MARGIN, width: 78 },
  { key: 'type', label: 'Fine', x: MARGIN + 82, width: 132 },
  { key: 'amount', label: 'Issued', x: MARGIN + 218, width: 78, align: 'right' },
  { key: 'settled', label: 'Paid', x: MARGIN + 300, width: 78, align: 'right' },
  { key: 'remaining', label: 'Owed', x: MARGIN + 382, width: 78, align: 'right' },
  { key: 'status', label: 'Status', x: MARGIN + 464, width: 30 },
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

// Streams one member's fine record as a PDF.
function renderFineReportPdf(res, report, chamaName) {
  const slug = (report.member.regNumber || report.member.name || 'member').replace(
    /[^a-z0-9]+/gi,
    '-'
  );

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="fines-${slug}.pdf"`);

  const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(17).text(chamaName || 'Contribution Manager');
  doc.font('Helvetica').fontSize(10).fillColor('#666').text(`${report.scopeLabel} - member record`);
  doc.moveDown(0.6);

  doc.fillColor('#000').font('Helvetica-Bold').fontSize(13).text(report.member.name);
  doc.font('Helvetica').fontSize(9).fillColor('#666');
  if (report.member.regNumber) doc.text(`Member number ${report.member.regNumber}`);
  if (report.member.phone) doc.text(`Phone ${report.member.phone}`);
  doc.text(`Member since ${shortDate(report.member.joinDate)}`);
  if (!report.member.active) doc.text('This member has resigned.');
  doc.moveDown(1);
  doc.fillColor('#000');

  // -------------------------------------------------------------- summary
  let y = sectionTitle(doc, doc.y, report.scopeLabel);
  const summaryLines = [
    ['Fines on record', String(report.summary.count)],
    ['Outstanding', `${report.summary.outstandingCount} (${money(report.summary.outstanding)})`],
    ['Cleared', `${report.summary.clearedCount} (${money(report.summary.settledAmount)})`],
    ['Voided', String(report.summary.voidedCount)],
    ['Issued in total', money(report.summary.totalAmount)],
    [
      'Period covered',
      report.summary.firstDate
        ? `${shortDate(report.summary.firstDate)} - ${shortDate(report.summary.lastDate)}`
        : '-',
    ],
    ['Payments applied', String(report.summary.settlements)],
    ['Report generated', shortDate(new Date())],
  ];

  for (const [label, value] of summaryLines) {
    y = ensureRoom(doc, y, 14);
    doc.font('Helvetica').fontSize(9);
    doc.text(label, MARGIN, y, { width: 250 });
    doc.text(value, MARGIN + 250, y, { width: 245, align: 'right' });
    y += 14;
  }
  y += 8;

  // ---------------------------------------------------------------- fines
  y = sectionTitle(doc, y, 'Every fine, newest first');
  y = tableHeader(doc, y, FINE_COLS);

  if (report.rows.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#666').text('No fines on record.', MARGIN, y);
    doc.fillColor('#000');
    y = doc.y;
  }

  const ordered = [...report.rows].sort((a, b) => new Date(b.date) - new Date(a.date));

  for (const row of ordered) {
    y = ensureRoom(doc, y, row.reason ? 26 : 14, FINE_COLS);
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    doc.text(shortDate(row.date), FINE_COLS[0].x, y, { width: FINE_COLS[0].width });
    doc.text(row.type, FINE_COLS[1].x, y, { width: FINE_COLS[1].width });
    doc.text(money(row.amount), FINE_COLS[2].x, y, {
      width: FINE_COLS[2].width,
      align: 'right',
    });
    doc.text(money(row.settled), FINE_COLS[3].x, y, {
      width: FINE_COLS[3].width,
      align: 'right',
    });
    doc.text(money(row.remaining), FINE_COLS[4].x, y, {
      width: FINE_COLS[4].width,
      align: 'right',
    });
    doc.fillColor(row.outstanding ? '#b3261e' : '#166534');
    doc.text(row.outstanding ? 'Due' : 'Paid', FINE_COLS[5].x, y, { width: FINE_COLS[5].width });
    doc.fillColor('#000');

    if (row.reason) {
      doc.font('Helvetica').fontSize(8).fillColor('#666');
      doc.text(row.reason, FINE_COLS[0].x, y + 11, { width: CONTENT_WIDTH - 40 });
      doc.fillColor('#000');
    }
    if (row.issuedBy) {
      doc.font('Helvetica').fontSize(8).fillColor('#888');
      doc.text(`Issued by ${row.issuedBy}`, FINE_COLS[3].x, y + 11, {
        width: 200,
        align: 'right',
      });
      doc.fillColor('#000');
    }
    y += row.reason ? 26 : 14;
  }

  // ----------------------------------------------------------- settlements
  const withSettlements = ordered.filter((row) => row.settlements.length > 0);
  if (withSettlements.length > 0) {
    y += 10;
    y = sectionTitle(doc, y, 'How each fine was paid off');
    for (const row of withSettlements) {
      y = ensureRoom(doc, y, 16 + row.settlements.length * 13);
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text(`${row.type} - ${shortDate(row.date)}`, MARGIN, y, { width: CONTENT_WIDTH });
      y += 13;
      for (const settlement of row.settlements) {
        doc.font('Helvetica').fontSize(8).fillColor('#666');
        doc.text(shortDate(settlement.date), MARGIN + 10, y, { width: 120 });
        doc.text(money(settlement.amount), MARGIN + 130, y, { width: 120, align: 'right' });
        doc.fillColor('#000');
        y += 13;
      }
    }
  }

  // --------------------------------------------------------------- voided
  if (report.voided.length > 0) {
    y += 10;
    y = sectionTitle(doc, y, 'Issued and later voided (not owed)');
    for (const row of report.voided) {
      y = ensureRoom(doc, y, 24);
      doc.font('Helvetica').fontSize(9);
      doc.text(shortDate(row.date), MARGIN, y, { width: 80 });
      doc.text(row.type, MARGIN + 85, y, { width: 200 });
      doc.text(money(row.amount), MARGIN + 285, y, { width: 100, align: 'right' });
      y += 12;
      if (row.reason) {
        doc.font('Helvetica').fontSize(8).fillColor('#666');
        doc.text(row.reason, MARGIN + 85, y, { width: CONTENT_WIDTH - 100 });
        doc.fillColor('#000');
        y += 12;
      }
    }
  }

  // --------------------------------------------------------------- footer
  y = ensureRoom(doc, y + 10, 36);
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#ccc').stroke();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#666')
    .text(
      'Taken from the group\u2019s own fine records. A fine appears here the moment it is ' +
        'issued and stays until it is settled or voided; voided fines are listed so the ' +
        'record can be reconciled against the meeting that ordered them.',
      MARGIN,
      y + 8,
      { width: CONTENT_WIDTH }
    );

  doc.end();
}

// The workbook: the same record, in sheets the office can sort and total.
function fineReportSheets(report, chamaName) {
  const summaryRows = [
    { Field: 'Chama', Value: chamaName || '' },
    { Field: 'Report', Value: report.scopeLabel },
    { Field: 'Member', Value: report.member.name },
    { Field: 'Registration number', Value: report.member.regNumber },
    { Field: 'Phone', Value: report.member.phone },
    { Field: 'Fines on record', Value: report.summary.count },
    { Field: 'Outstanding fines', Value: report.summary.outstandingCount },
    { Field: 'Amount still owed', Value: report.summary.outstanding },
    { Field: 'Cleared fines', Value: report.summary.clearedCount },
    { Field: 'Amount cleared', Value: report.summary.settledAmount },
    { Field: 'Voided fines', Value: report.summary.voidedCount },
    { Field: 'Issued in total', Value: report.summary.totalAmount },
    {
      Field: 'Period covered',
      Value: report.summary.firstDate
        ? `${shortDate(report.summary.firstDate)} - ${shortDate(report.summary.lastDate)}`
        : '',
    },
    { Field: 'Generated on', Value: report.generatedAt },
  ];

  const fineRows = report.rows.map((row) => ({
    Date: row.date,
    Fine: row.type,
    Category: row.category,
    Reason: row.reason,
    Issued: row.amount,
    Paid: row.settled,
    Owed: row.remaining,
    Status: row.status,
    'Issued by': row.issuedBy,
  }));
  fineRows.push({
    Date: '',
    Fine: 'TOTAL',
    Category: '',
    Reason: '',
    Issued: report.summary.totalAmount,
    Paid: report.summary.settledAmount,
    Owed: report.summary.outstanding,
    Status: '',
    'Issued by': '',
  });

  const settlementRows = [];
  for (const row of report.rows) {
    for (const settlement of row.settlements) {
      settlementRows.push({
        'Fine date': row.date,
        Fine: row.type,
        'Payment date': settlement.date,
        Amount: settlement.amount,
      });
    }
  }

  const voidedRows = report.voided.map((row) => ({
    Date: row.date,
    Fine: row.type,
    Reason: row.reason,
    Amount: row.amount,
    'Issued by': row.issuedBy,
    Note: 'Voided - not owed',
  }));

  return [
    { name: 'Summary', rows: summaryRows },
    { name: 'Fines', rows: fineRows },
    { name: 'Settlements', rows: settlementRows },
    { name: 'Voided', rows: voidedRows },
  ];
}

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
    status: remaining > 0 ? 'Outstanding' : 'Cleared',
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
    };
    member.issued += row.amount;
    member.outstanding += row.remaining;
    member.fines += 1;
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
    },
    byType: [...byTypeMap.values()].sort((a, b) => b.outstanding - a.outstanding || b.issued - a.issued),
    byMember: [...byMemberMap.values()].sort((a, b) => b.outstanding - a.outstanding || b.issued - a.issued),
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

  doc.font('Helvetica-Bold').fontSize(17).text(chamaName || 'Contribution Manager');
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
  buildFineReport,
  renderFineReportPdf,
  fineReportSheets,
  buildFineGroupReport,
  renderFineGroupReportPdf,
  fineGroupReportSheets,
  money,
  shortDate,
};

