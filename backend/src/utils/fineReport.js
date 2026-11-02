// The fines reports: one member's fines, and the group's fines over a period, as figures, PDF and sheets.
//
// The pieces live in utils/fineReport/:
//
//   format  how money and dates are written
//   layout  the PDF page: margins, tables, section titles
//   single  the report on one set of fines
//   group   the report across the group, by month and by member
//
// This file only gathers them, so every caller and test that requires it keeps working.

const { buildFineReport, renderFineReportPdf, fineReportSheets } = require('./fineReport/single');
const { buildFineGroupReport, renderFineGroupReportPdf, fineGroupReportSheets } = require('./fineReport/group');
const { money, shortDate } = require('./fineReport/format');

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
