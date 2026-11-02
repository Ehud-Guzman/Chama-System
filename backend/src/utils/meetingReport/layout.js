// The meeting report, part: layout. utils/meetingReport.js is the index everything else requires.



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

module.exports = {
  CONTENT_WIDTH,
  GREEN,
  GREY,
  MARGIN,
  RED,
  caption,
  drawTable,
  figureLines,
  nameCell,
  sectionTitle,
};
