const PDFDocument = require('pdfkit');

const numberFmt = new Intl.NumberFormat('en-KE');
function money(amount) {
  return `Ksh ${numberFmt.format(Number(amount) || 0)}`;
}
function shortDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const MARGIN = 50;
const COLS = [
  { key: 'date', label: 'Date', x: MARGIN, width: 80 },
  { key: 'type', label: 'Type', x: MARGIN + 85, width: 130 },
  { key: 'method', label: 'Method', x: MARGIN + 220, width: 70 },
  { key: 'amount', label: 'Amount', x: MARGIN + 295, width: 80, align: 'right' },
  { key: 'balance', label: 'Balance', x: MARGIN + 380, width: 80, align: 'right' },
];

function drawTableHeader(doc, y) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#444');
  for (const col of COLS) {
    doc.text(col.label, col.x, y, { width: col.width, align: col.align || 'left' });
  }
  doc
    .moveTo(MARGIN, y + 14)
    .lineTo(MARGIN + 460, y + 14)
    .strokeColor('#ccc')
    .stroke();
  doc.font('Helvetica').fillColor('#000');
  return y + 20;
}

function ensureRoom(doc, y, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (y + needed <= bottom) return y;
  doc.addPage();
  return drawTableHeader(doc, MARGIN);
}

// Streams a formatted PDF statement to `res` for one member — the individual
// download format, since a CSV/spreadsheet isn't a great fit for someone
// checking their own record on a phone.
function renderStatementPdf(res, profile, chamaName) {
  const slug = (profile.regNumber || profile.name).replace(/[^a-z0-9]+/gi, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="statement-${slug}.pdf"`);

  const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(16).text(chamaName || 'Contribution Manager');
  doc.font('Helvetica').fontSize(10).fillColor('#666').text('Contribution Statement');
  doc.moveDown(0.5);

  doc.fillColor('#000').fontSize(13).font('Helvetica-Bold').text(profile.name);
  doc.font('Helvetica').fontSize(9).fillColor('#666');
  if (profile.regNumber) doc.text(`Member № ${profile.regNumber}`);
  doc.text(`Generated ${shortDate(new Date())}`);
  doc.moveDown(1);
  doc.fillColor('#000');

  let y = drawTableHeader(doc, doc.y);

  if (profile.contributions.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor('#666').text('No contributions recorded yet.', MARGIN, y);
    y = doc.y;
  }

  for (const c of profile.contributions) {
    const rowHeight = c.fineDeducted > 0 || c.isGroupFund ? 28 : 16;
    y = ensureRoom(doc, y, rowHeight);

    doc.fontSize(9).fillColor('#000');
    doc.text(shortDate(c.date), COLS[0].x, y, { width: COLS[0].width });
    doc.text(c.type || '', COLS[1].x, y, { width: COLS[1].width });
    doc.text(c.method || '', COLS[2].x, y, { width: COLS[2].width });
    doc.text(money(c.amount), COLS[3].x, y, { width: COLS[3].width, align: 'right' });
    doc.text(money(c.runningBalance), COLS[4].x, y, { width: COLS[4].width, align: 'right' });

    if (c.fineDeducted > 0) {
      doc
        .fontSize(8)
        .fillColor('#b3261e')
        .text(`− ${money(c.fineDeducted)} to fines (paid ${money(c.grossAmount)})`, COLS[0].x, y + 12, {
          width: 300,
        });
      doc.fillColor('#000');
    } else if (c.isGroupFund) {
      doc
        .fontSize(8)
        .fillColor('#888')
        .text('Group fund — not counted in personal balance', COLS[0].x, y + 12, { width: 300 });
      doc.fillColor('#000');
    }

    y += rowHeight;
  }

  y = ensureRoom(doc, y, 70);
  doc
    .moveTo(MARGIN, y + 4)
    .lineTo(MARGIN + 460, y + 4)
    .strokeColor('#000')
    .stroke();
  y += 14;

  doc.font('Helvetica-Bold').fontSize(11);
  doc.text(`Total contributed (all-time): ${money(profile.totalContributed)}`, MARGIN, y);
  y += 16;
  if (profile.totalPledged > 0) {
    doc.font('Helvetica').fontSize(10).text(`Total pledged: ${money(profile.totalPledged)}`, MARGIN, y);
    y += 14;
  }
  if (profile.fines?.totalOwed > 0) {
    doc
      .font('Helvetica-Bold')
      .fillColor('#b3261e')
      .fontSize(10)
      .text(`Fines owed: ${money(profile.fines.totalOwed)}`, MARGIN, y);
    doc.fillColor('#000');
  }

  doc.end();
}

module.exports = { renderStatementPdf };
