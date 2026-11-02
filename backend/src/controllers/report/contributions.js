// The reports controller, part: contributions. controllers/reportController.js is the index the routes use.

const Contribution = require('../../models/Contribution');
const { sendWorkbook } = require('../../utils/xlsxExport');
const { aboutSheet } = require('../../utils/aboutSheet');
const { getOrCreateSettings } = require('../../utils/settings');
const { computeWeeklyReconciliation } = require('../../utils/weeklyReconciliation');
const { computeBackupHealth } = require('../../utils/backupHealth');

// GET /api/reports/export — all contributions with member names, .xlsx workbook
async function exportContributions(req, res, next) {
  try {
    const contributions = await Contribution.find({ deleted: false })
      .sort({ date: 1, createdAt: 1 })
      .populate('memberId', 'name phone regNumber')
      .populate('loggedBy', 'name')
      .populate('typeId', 'name')
      .lean();

    const sheetRows = contributions.map((c) => ({
      Date: new Date(c.date).toISOString().slice(0, 10),
      Member: c.memberId?.name || 'Unknown',
      'Reg number': c.memberId?.regNumber || '',
      Phone: c.memberId?.phone || '',
      Type: c.typeId?.name || '',
      Amount: c.amount,
      Method: c.method,
      Note: c.note || '',
      'Logged by': c.loggedBy?.name || '',
    }));
    sendWorkbook(res, 'contributions.xlsx', [
      aboutSheet({
        name: 'Contribution history',
        settings: await getOrCreateSettings(),
        req,
        counts: [['Contribution rows', sheetRows.length]],
        notes:
          'Every contribution row logged in this ledger, oldest first. Money carried forward ' +
          'from the paper ledger is not a row and is not in this sheet, so the total here is ' +
          'what this ledger has watched come in.',
      }),
      { name: 'Contributions', rows: sheetRows },
    ]);
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/weekly — chama-wide week-by-week reconciliation (expected vs actual)
async function weekly(req, res, next) {
  try {
    // The week's figures, and alongside them the one fact about the books that is not a figure:
    // how old the last copy taken off this machine is. The committee reads this screen every week,
    // and a backup that nobody has downloaded for two months is exactly the kind of thing that only
    // gets noticed if it is put in front of somebody — `backup.note` says it, or is null when the
    // last copy is recent enough to be nobody's business.
    const [weeks, backup] = await Promise.all([computeWeeklyReconciliation(), computeBackupHealth()]);
    res.json({ weeks, backup });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/weekly/export — same data as an .xlsx workbook, one row per week × type
async function exportWeekly(req, res, next) {
  try {
    const [weeks, backup] = await Promise.all([computeWeeklyReconciliation(), computeBackupHealth()]);
    const overviewRows = weeks.map((w) => ({
      Week: w.weekNumber,
      'Start date': w.startDate.toISOString().slice(0, 10),
      'End date': w.endDate.toISOString().slice(0, 10),
      // The members' own money first: it is the figure the week is judged on.
      'Member contributions': w.memberTotal,
      'Members paid': w.memberPaidCount,
      'Members eligible': w.memberEligibleCount,
      'Group funds': w.groupFundTotal,
      Expected: w.expectedTotal,
      Actual: w.actualTotal,
      Diff: w.diff,
      'Members short': w.shortfallCount,
      'All paid': w.balanced ? 'Yes' : 'No',
    }));

    const shortfallRows = [];
    const paidRows = [];
    for (const w of weeks) {
      for (const t of w.types) {
        for (const m of t.shortfallMembers) {
          shortfallRows.push({
            Week: w.weekNumber,
            Type: t.typeName,
            Member: m.name,
            'Reg number': m.regNumber || '',
            Status: m.status,
            Paid: m.paid,
            Expected: t.weeklyAmount,
          });
        }
        // The other half of the same week, so the workbook names both sides the
        // way the screen does: a shortfall sheet on its own leaves a week's
        // collected money unattributed — every name on it reads zero.
        for (const m of t.paidMembers || []) {
          paidRows.push({
            Week: w.weekNumber,
            Type: t.typeName,
            Member: m.name,
            'Reg number': m.regNumber || '',
            Status: 'paid',
            Paid: m.paid,
            Expected: t.weeklyAmount,
          });
        }
      }
    }

    sendWorkbook(res, 'weekly-reconciliation.xlsx', [
      aboutSheet({
        name: 'Weekly reconciliation',
        settings: await getOrCreateSettings(),
        req,
        counts: [
          ['Weeks covered', weeks.length],
          ['Shortfall rows', shortfallRows.length],
          ['Paid-in-full rows', paidRows.length],
        ],
        notes:
          'Expected versus actual, week by week, per fixed weekly fund. The opening week expects ' +
          'nothing (every member\u2019s money for it is already carried forward) and the week still ' +
          'running is not scored. A week is "short" when at least one eligible member still owes ' +
          'their weekly minimum; "Paid in full" names the members who met it, with what each of ' +
          'them put in, so the two sheets together account for every eligible member.' +
          // The screen names this on the week's own list; a workbook that leaves the building
          // should not be the one place the warning is missing.
          (backup.note ? ` BACKUP: ${backup.note}` : ''),
      }),
      { name: 'Weeks', rows: overviewRows },
      // Contributors before shortfalls, matching the weekly screen: the sheet a
      // treasurer opens first is the one naming who paid.
      { name: 'Paid in full', rows: paidRows },
      { name: 'Shortfalls', rows: shortfallRows },
    ]);
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/trend?weeks=12 — the last N weeks, oldest first, for the trend
// chart the summary opens with: what the members put in each week, what the funds
// took alongside them, and how many were still short when the week closed.
async function trend(req, res, next) {
  try {
    const wanted = Math.min(52, Math.max(4, parseInt(req.query.weeks, 10) || 12));
    const weeks = await computeWeeklyReconciliation();
    // computeWeeklyReconciliation() answers newest-first (that is how the weekly
    // screen reads); a chart reads left to right.
    const recent = weeks.slice(0, wanted).reverse();

    res.json({
      weeks: recent.map((w) => ({
        weekNumber: w.weekNumber,
        startDate: w.startDate,
        endDate: w.endDate,
        label: `Wk ${w.weekNumber}`,
        memberTotal: w.memberTotal,
        groupFundTotal: w.groupFundTotal,
        total: w.memberTotal + w.groupFundTotal,
        expected: w.memberExpected,
        memberPaidCount: w.memberPaidCount,
        memberEligibleCount: w.memberEligibleCount,
        shortfallCount: w.shortfallCount,
        balanced: w.balanced,
        isBaseline: w.isBaseline,
        isCurrent: w.isCurrent,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  exportContributions,
  exportWeekly,
  trend,
  weekly,
};
