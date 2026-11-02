// The meeting report, part: pdf. utils/meetingReport.js is the index everything else requires.

const PDFDocument = require('pdfkit');
const { CONTENT_WIDTH, GREY, MARGIN } = require('./layout');
const { printable, shortDate } = require('./format');
const { renderDebts, renderExpenses, renderExtra, renderFines, renderGlance, renderPosition, renderWeek } = require('./sections');

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
  if (report.expenses) renderExpenses(doc, y, report.expenses);

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
  buildPdfBuffer,
  renderMeetingReportPdf,
};
