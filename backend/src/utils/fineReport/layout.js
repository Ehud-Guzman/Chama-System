// The fines reports, part: layout. utils/fineReport.js is the index everything else requires.



// Swaps the standard PDF fonts for an embedded one with every Kenyan letter, so names print as written (pdfFonts.js).
require('../pdfFonts');

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

module.exports = {
  CONTENT_WIDTH,
  FINE_COLS,
  MARGIN,
  ensureRoom,
  sectionTitle,
  tableHeader,
};
