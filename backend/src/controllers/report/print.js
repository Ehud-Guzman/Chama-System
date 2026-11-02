// The reports controller, part: print. controllers/reportController.js is the index the routes use.

const Expense = require('../../models/Expense');
const Member = require('../../models/Member');
const { parseSections, EXPENSE_ROLES, EXPENSE_PERIODS, expensePeriod, buildMeetingReport, renderMeetingReportPdf } = require('../../utils/meetingReport');
const { getOrCreateSettings } = require('../../utils/settings');
const { resolveConfig } = require('../../utils/weekCycle');
const { moneyLimitForWeek } = require('../../utils/reminderLimit');
const { computeMoneyPosition } = require('../../utils/moneyPosition');
const { totalFinesCollected } = require('../../utils/finesCollected');
const { computeMemberDues } = require('../notificationController');
const { computeThisWeek } = require('./summary');
const { computeFinesReport } = require('./fines');

// GET /api/reports/print?sections=debts,fines&expenses=week|month|all — the meeting report, as a
// PDF: the sections asked for, each closed by its totals (utils/meetingReport).
//
// Only what was asked for is read. A page printed for the fines alone should not wait on the
// ledger of every member, and should not carry the spending.
async function printReport(req, res, next) {
  try {
    const parsed = parseSections(req.query.sections);
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    // Spending is itemised by voucher, which the expenses screen shows only to the people who keep
    // the books. The reports roles are wider than that, so the gate is repeated here rather than
    // inherited: a secretary can print the rest of the page, not this part of it.
    const mayPrintSpending = EXPENSE_ROLES.includes(req.user?.role);
    if (!mayPrintSpending && parsed.sections.includes('expenses')) {
      // Asking for it by name is refused. Not naming any section means "everything I may have",
      // which for this role is the page without the spending rather than no page at all.
      if (req.query.sections !== undefined) {
        return res.status(403).json({ message: 'Your role cannot print the spending section' });
      }
      parsed.sections = parsed.sections.filter((key) => key !== 'expenses');
    }
    const { sections } = parsed;
    const wants = (key) => sections.includes(key);
    const periodKey = String(req.query.expenses || 'week').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(EXPENSE_PERIODS, periodKey)) {
      return res
        .status(400)
        .json({ message: `Unknown expenses period. Choose from ${Object.keys(EXPENSE_PERIODS).join(', ')}` });
    }

    const settings = await getOrCreateSettings();
    const config = resolveConfig(settings);
    const needsMembers = wants('debts') || wants('extra');

    // The week the group is in is always read: it is the page's own heading, and the line is its
    // week's line. It is cheap, and the section that prints it is the same one the summary shows.
    const week = await computeThisWeek(config);
    const line = moneyLimitForWeek(settings, config, week.weekNumber);
    const period = wants('expenses')
      ? expensePeriod(periodKey, { weekStart: week.startDate, weekEnd: week.endDate })
      : null;

    const [memberRows, position, finesCollected, fines, expenses] = await Promise.all([
      needsMembers ? loadMembersAgainstLine(settings) : [],
      wants('position') ? computeMoneyPosition() : null,
      wants('position') ? totalFinesCollected() : 0,
      wants('fines') ? computeFinesReport() : null,
      wants('expenses')
        ? Expense.find({
            deleted: false,
            ...(period.from ? { date: { $gte: period.from, $lte: period.to } } : {}),
          })
            .sort({ date: -1, createdAt: -1 })
            .populate('typeId', 'name isRecoverable')
            .populate('loggedBy', 'name')
            .lean()
        : [],
    ]);

    const report = buildMeetingReport({
      chamaName: settings.chamaName,
      preparedBy: req.user?.name || '',
      sections,
      week,
      line,
      members: memberRows,
      position,
      finesCollected,
      fines,
      expenses,
      period,
    });
    await renderMeetingReportPdf(res, report);
  } catch (err) {
    next(err);
  }
}

// Every active member with what the group is holding for him and how many closed weeks stand
// unpaid — read through the same function the reminders screen reads, so "below the line" here is
// the reminders' own decision rather than a second reading of the ledger.
async function loadMembersAgainstLine(settings) {
  const members = await Member.find({ active: true })
    .select('name regNumber phone openingBalance fineDebits')
    .sort({ name: 1 })
    .lean();
  const dues = await computeMemberDues(members, { settings });
  return members.map((member) => {
    const due = dues.get(String(member._id));
    return {
      memberId: member._id,
      name: member.name,
      regNumber: member.regNumber || '',
      held: due ? due.moneyHeld : Number(member.openingBalance) || 0,
      // Whole for a member below the line; a member at or above it is not listed with weeks.
      weeksUnpaid: due ? due.lateWeeks.length : 0,
    };
  });
}

module.exports = {
  printReport,
};
