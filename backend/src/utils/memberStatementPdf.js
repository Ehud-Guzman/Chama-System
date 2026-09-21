const PDFDocument = require('pdfkit');
const { buildStatement, reconciliationLines, money, shortDate } = require('./memberStatement');
const { CHAMA_NAME } = require('../data/branding');

// The member's own statement as a PDF — the format a person actually reads on a
// phone, and the one the office prints for a file.
//
// It answers the questions a member asks, in order: what do I hold, where does that
// come from, what have I paid and into which fund, how have the weeks gone, and what
// do I still owe. The workbook (memberStatementSheets) carries the same figures,
// sheet by sheet.

const MARGIN = 50;
const CONTENT_WIDTH = 495;

const CONTRIB_COLS = [
  { key: 'date', label: 'Date', x: MARGIN, width: 80 },
  { key: 'type', label: 'Type', x: MARGIN + 85, width: 130 },
  { key: 'method', label: 'Method', x: MARGIN + 220, width: 70 },
  { key: 'amount', label: 'Amount', x: MARGIN + 295, width: 80, align: 'right' },
  { key: 'balance', label: 'Paid to date', x: MARGIN + 380, width: 80, align: 'right' },
];

function tableHeader(doc, y, cols) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#444');
  for (const col of cols) {
    doc.text(col.label, col.x, y, { width: col.width, align: col.align || 'left' });
  }
  doc
    .moveTo(MARGIN, y + 14)
    .lineTo(MARGIN + CONTENT_WIDTH, y + 14)
    .strokeColor('#ccc')
    .stroke();
  doc.font('Helvetica').fillColor('#000');
  return y + 20;
}

function ensureRoom(doc, y, needed, cols) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (y + needed <= bottom) return y;
  doc.addPage();
  return cols ? tableHeader(doc, MARGIN, cols) : MARGIN;
}

// A small heading over a block, so a long report still reads in sections.
function sectionTitle(doc, y, title) {
  y = ensureRoom(doc, y, 34);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#166534').text(title, MARGIN, y);
  doc.fillColor('#000').font('Helvetica');
  return y + 18;
}

function renderMemberStatementPdf(res, profile, chamaName) {
  const statement = buildStatement(profile);
  const slug = (statement.member.regNumber || statement.member.name || 'member').replace(
    /[^a-z0-9]+/gi,
    '-'
  );

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="statement-${slug}.pdf"`);

  const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
  doc.pipe(res);

  const period = statement.period;

  // ----------------------------------------------------------------- header
  doc.font('Helvetica-Bold').fontSize(17).text(chamaName || CHAMA_NAME);
  doc.font('Helvetica').fontSize(10).fillColor('#666').text('Member Contribution Statement');
  doc.moveDown(0.6);
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(13).text(statement.member.name);
  doc.font('Helvetica').fontSize(9).fillColor('#666');
  if (statement.member.regNumber) doc.text(`Member number ${statement.member.regNumber}`);
  if (statement.member.phoneMasked) doc.text(`Phone ${statement.member.phoneMasked}`);
  // What this statement covers, on the same lines as who it is for. A period statement without its
  // period printed on it is a page of figures that cannot be checked against anything.
  if (period) {
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
    doc.text(`Period: ${period.label}`);
    doc.font('Helvetica').fillColor('#666').fontSize(9);
    if (period.note) doc.text(period.note, { width: CONTENT_WIDTH });
    doc.fillColor('#000');
  }
  doc.moveDown(1);
  doc.fillColor('#000');

  // ---------------------------------------------------------------- figures
  let y = sectionTitle(doc, doc.y, period ? 'Where he stood in this period' : 'Where he stands');
  for (const figure of statement.figures) {
    y = ensureRoom(doc, y, 16);
    doc.font(figure.strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(figure.strong ? 10 : 9);
    doc.fillColor(figure.alert ? '#b3261e' : '#000');
    doc.text(figure.label, MARGIN, y, { width: 300 });
    doc.text(
      typeof figure.value === 'string' ? figure.value : money(figure.value),
      MARGIN + 300,
      y,
      { width: 195, align: 'right' }
    );
    doc.fillColor('#000');
    y += figure.strong ? 16 : 14;
  }

  // ------------------------------------------------------- the arithmetic
  // Printed as a sum rather than a list of facts, because this is the block somebody will check by
  // hand across a table — and if it does not add up, the statement says so here instead of being
  // handed over as though it did.
  if (period) {
    y = sectionTitle(doc, y, 'How that adds up');
    for (const line of reconciliationLines(period)) {
      y = ensureRoom(doc, y, 16);
      doc.font('Helvetica').fontSize(9).fillColor('#000');
      doc.text(`${line.sign ? `${line.sign}  ` : ''}${line.label}`, MARGIN, y, { width: 300 });
      doc.text(money(line.value), MARGIN + 300, y, { width: 195, align: 'right' });
      y += 14;
    }
    y = ensureRoom(doc, y, 26);
    if (period.balanced) {
      doc.font('Helvetica').fontSize(8).fillColor('#666');
      doc.text('The arithmetic above reconciles.', MARGIN, y, { width: CONTENT_WIDTH });
    } else {
      // Deliberately loud. A statement that does not add up must never look like one that does, and
      // the office needs to be told here rather than by a member at a meeting.
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#b3261e');
      doc.text(
        'THESE FIGURES DO NOT RECONCILE. Do not issue this statement — report it to whoever maintains the system.',
        MARGIN,
        y,
        { width: CONTENT_WIDTH }
      );
    }
    doc.fillColor('#000').font('Helvetica');
    y += 18;
  }

  y += 8;

  // ------------------------------------------------------------- by type
  if (statement.byType.length > 0) {
    y = sectionTitle(doc, y, 'What he has paid, by fund');
    for (const entry of statement.byType) {
      y = ensureRoom(doc, y, 14);
      doc.font('Helvetica').fontSize(9);
      doc.text(entry.type || '', MARGIN, y, { width: 300 });
      doc.text(money(entry.contributed), MARGIN + 300, y, { width: 195, align: 'right' });
      y += 14;
    }
    y += 10;
  }

  // ---------------------------------------------------------- month by month
  y = sectionTitle(doc, y, 'His own contributions, month by month');
  for (const month of statement.monthly) {
    y = ensureRoom(doc, y, 14);
    doc.font('Helvetica').fontSize(9);
    doc.text(month.label, MARGIN, y, { width: 300 });
    doc.text(money(month.amount), MARGIN + 300, y, { width: 195, align: 'right' });
    y += 14;
  }
  y = ensureRoom(doc, y, 16);
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Total for the months above', MARGIN, y, { width: 300 });
  doc.text(money(statement.monthlyTotal), MARGIN + 300, y, { width: 195, align: 'right' });
  y += 20;

  // --------------------------------------------------------------- weekly
  if (statement.weekly.length > 0) {
    const cols = [
      { key: 'week', label: 'Week', x: MARGIN, width: 60 },
      { key: 'dates', label: 'Dates', x: MARGIN + 65, width: 180 },
      { key: 'expected', label: 'Expected', x: MARGIN + 250, width: 80, align: 'right' },
      { key: 'paid', label: 'Paid', x: MARGIN + 335, width: 75, align: 'right' },
      { key: 'status', label: 'Status', x: MARGIN + 415, width: 80 },
    ];

    y = sectionTitle(doc, y, `Weekly contribution - last ${statement.weeksShown} weeks`);
    y = tableHeader(doc, y, cols);

    for (const schedule of statement.weekly) {
      for (const week of schedule.weeks.slice(0, statement.weeksShown)) {
        y = ensureRoom(doc, y, 14, cols);
        doc.font('Helvetica').fontSize(9);
        doc.text(`Wk ${week.weekNumber}${week.isCurrent ? ' (now)' : ''}`, cols[0].x, y, {
          width: cols[0].width,
        });
        doc.text(`${shortDate(week.startDate)} - ${shortDate(week.endDate)}`, cols[1].x, y, {
          width: cols[1].width,
        });
        doc.text(money(week.expected), cols[2].x, y, { width: cols[2].width, align: 'right' });
        doc.text(money(week.paid), cols[3].x, y, { width: cols[3].width, align: 'right' });
        doc.text(week.status, cols[4].x, y, { width: cols[4].width });
        y += 14;
      }

      if (schedule.historyCount > 0) {
        y = ensureRoom(doc, y, 26, cols);
        doc.font('Helvetica').fontSize(8).fillColor('#666');
        doc.text(
          `Weeks 1-${schedule.historyCount} (before this ledger opened): ${money(
            schedule.historyPaid
          )} was collected in that time and is inside the carried-forward figure above.`,
          MARGIN,
          y,
          { width: CONTENT_WIDTH }
        );
        doc.fillColor('#000');
        y = doc.y + 4;
      }
    }
    y += 10;
  }

  // ---------------------------------------------------------------- fines
  if (statement.fines.pending.length > 0 || statement.fines.settled.length > 0) {
    const cols = [
      { key: 'date', label: 'Date', x: MARGIN, width: 80 },
      { key: 'type', label: 'Fine', x: MARGIN + 85, width: 130 },
      { key: 'amount', label: 'Amount', x: MARGIN + 220, width: 75, align: 'right' },
      { key: 'remaining', label: 'Owed', x: MARGIN + 300, width: 75, align: 'right' },
      { key: 'status', label: 'Status', x: MARGIN + 380, width: 80 },
    ];

    y = sectionTitle(doc, y, 'Fines');
    y = tableHeader(doc, y, cols);

    for (const fine of [...statement.fines.pending, ...statement.fines.settled]) {
      const outstanding = Number(fine.remaining) > 0;
      y = ensureRoom(doc, y, fine.reason ? 24 : 14, cols);
      doc.font('Helvetica').fontSize(9).fillColor('#000');
      doc.text(shortDate(fine.date), cols[0].x, y, { width: cols[0].width });
      doc.text(fine.type || '', cols[1].x, y, { width: cols[1].width });
      doc.text(money(fine.amount), cols[2].x, y, { width: cols[2].width, align: 'right' });
      doc.text(money(fine.remaining), cols[3].x, y, { width: cols[3].width, align: 'right' });
      doc.fillColor(outstanding ? '#b3261e' : '#166534');
      doc.text(outstanding ? 'Outstanding' : 'Cleared', cols[4].x, y, { width: cols[4].width });
      doc.fillColor('#000');

      if (fine.reason) {
        doc.font('Helvetica').fontSize(8).fillColor('#666');
        doc.text(fine.reason, cols[0].x, y + 11, { width: CONTENT_WIDTH - 60 });
        doc.fillColor('#000');
      }
      y += fine.reason ? 24 : 14;
    }

    y = ensureRoom(doc, y, 18);
    doc.font('Helvetica-Bold').fontSize(9);
    doc.fillColor(statement.fines.totalOwed > 0 ? '#b3261e' : '#000');
    doc.text('Fines owed now', MARGIN, y, { width: 300 });
    doc.text(money(statement.fines.totalOwed), MARGIN + 300, y, { width: 195, align: 'right' });
    doc.fillColor('#000');
    y += 20;
  }

  // --------------------------------------------------------- contributions
  y = sectionTitle(doc, y, `Every contribution logged (${statement.contributions.length})`);
  y = tableHeader(doc, y, CONTRIB_COLS);

  if (statement.contributions.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#666').text('No contributions recorded yet.', MARGIN, y);
    doc.fillColor('#000');
    y = doc.y;
  }

  for (const c of statement.contributions) {
    const rowHeight = c.fineDeducted > 0 || c.isGroupFund ? 26 : 14;
    y = ensureRoom(doc, y, rowHeight, CONTRIB_COLS);
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    doc.text(shortDate(c.date), CONTRIB_COLS[0].x, y, { width: CONTRIB_COLS[0].width });
    doc.text(c.type || '', CONTRIB_COLS[1].x, y, { width: CONTRIB_COLS[1].width });
    doc.text(c.method || '', CONTRIB_COLS[2].x, y, { width: CONTRIB_COLS[2].width });
    doc.text(money(c.amount), CONTRIB_COLS[3].x, y, {
      width: CONTRIB_COLS[3].width,
      align: 'right',
    });
    doc.text(money(c.runningBalance), CONTRIB_COLS[4].x, y, {
      width: CONTRIB_COLS[4].width,
      align: 'right',
    });

    if (c.fineDeducted > 0) {
      doc
        .fontSize(8)
        .fillColor('#b3261e')
        .text(
          `- ${money(c.fineDeducted)} to fines (paid ${money(c.grossAmount)})`,
          CONTRIB_COLS[0].x,
          y + 11,
          { width: 320 }
        );
      doc.fillColor('#000');
    } else if (c.isGroupFund) {
      doc
        .fontSize(8)
        .fillColor('#888')
        .text('Group fund - not counted in his own balance', CONTRIB_COLS[0].x, y + 11, {
          width: 320,
        });
      doc.fillColor('#000');
    }

    y += rowHeight;
  }

  // ----------------------------------------------------------------- footer
  y = ensureRoom(doc, y, 40);
  doc.moveTo(MARGIN, y + 6).lineTo(MARGIN + CONTENT_WIDTH, y + 6).strokeColor('#ccc').stroke();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#666')
    .text(
      'Generated from the group\u2019s own ledger. A statement records what actually moved - ' +
        'contributions logged, fines issued and settled - and is not a receipt for cash held elsewhere.',
      MARGIN,
      y + 14,
      { width: CONTENT_WIDTH }
    );

  doc.end();
}

module.exports = { renderMemberStatementPdf };
