// The reports controller.
//
// The handlers live in controllers/report/, one file per report:
//
//   performance    how each member is doing against the cycle, and its export
//   summary        the dashboard summary and this week's collection
//   monthly        the month-by-month report and its export
//   contributions  the contribution export, the weekly report and the trend line
//   member         one member's report and his monthly history
//   fines          the fines report and its export
//   print          the printable meeting report
//
// This file only gathers them, so every route and test that requires it keeps working.

const { summary } = require('./report/summary');
const { exportContributions, weekly, exportWeekly, trend } = require('./report/contributions');
const { performance, exportPerformance } = require('./report/performance');
const { monthly, exportMonthly } = require('./report/monthly');
const { finesReport, exportFinesReport } = require('./report/fines');
const { printReport } = require('./report/print');
const { memberReport } = require('./report/member');

module.exports = {
  summary,
  exportContributions,
  performance,
  exportPerformance,
  monthly,
  exportMonthly,
  weekly,
  exportWeekly,
  trend,
  finesReport,
  exportFinesReport,
  printReport,
  memberReport,
};
