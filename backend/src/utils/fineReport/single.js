// The fines reports, part: single. utils/fineReport.js is the index everything else requires.

const PDFDocument = require('pdfkit');
const { CHAMA_NAME } = require('../../data/branding');
const { CONTENT_WIDTH, FINE_COLS, MARGIN, ensureRoom, sectionTitle, tableHeader } = require('./layout');
const { money, shortDate } = require('./format');

// How a payment reached the group, in the words a member would use. A payment recorded before the
// office was asked how it was made says so rather than guessing.
function howPaid(settlement) {
  const source = settlement.source || (settlement.contributionId ? 'contribution' : null);
  if (source === 'balance') return 'Taken from his balance';
  if (source === 'cash') return 'Paid separately (cash / M-Pesa)';
  if (source === 'contribution') return 'Out of a contribution';
  return 'Recorded earlier';
}

// Everything both the PDF and the workbook print, in one place.
function buildFineReport({ member, fines, voidedFines = [], scopeLabel }) {
  const rows = fines.map((fine) => {
    const amount = Number(fine.amount) || 0;
    const remaining = Number(fine.remaining) || 0;
    const settlements = (fine.settlements || []).map((s) => ({
      date: s.date,
      amount: Number(s.amount) || 0,
      how: howPaid(s),
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
      status: remaining > 0 ? 'Still owed' : 'Paid off',
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

  doc.font('Helvetica-Bold').fontSize(17).text(chamaName || CHAMA_NAME);
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
        doc.text(settlement.how, MARGIN + 265, y, { width: CONTENT_WIDTH - 265 });
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
        'How paid': settlement.how,
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

module.exports = {
  buildFineReport,
  fineReportSheets,
  renderFineReportPdf,
};
