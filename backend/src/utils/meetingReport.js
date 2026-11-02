// The meeting report: what the group reads at its meeting, as figures and as a printable PDF.
//
// The pieces live in utils/meetingReport/:
//
//   data      which sections exist, and building the report's figures from the books
//   format    how money, dates and plurals are written, and what the PDF font can print
//   layout    the PDF page: margins, colours, tables, section titles
//   sections  drawing each section of the report
//   pdf       putting the sections on pages and returning the file
//
// This file only gathers them, so every caller and test that requires it keeps working.

const { SECTIONS, SECTION_KEYS, EXPENSE_ROLES, EXPENSE_PERIODS, parseSections, expensePeriod, splitByLine, buildMeetingReport } = require('./meetingReport/data');
const { printable } = require('./meetingReport/format');
const { buildPdfBuffer, renderMeetingReportPdf } = require('./meetingReport/pdf');

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
