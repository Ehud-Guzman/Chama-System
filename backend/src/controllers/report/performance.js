// The reports controller, part: performance. controllers/reportController.js is the index the routes use.

const Member = require('../../models/Member');
const ContributionType = require('../../models/ContributionType');
const Contribution = require('../../models/Contribution');
const Fine = require('../../models/Fine');
const { nonPersonalTypeIds } = require('../../utils/personalTypes');
const { getOrCreateSettings } = require('../../utils/settings');
const { resolveConfig, weeklyAmountForWeek } = require('../../utils/weekCycle');
const { buildWeeklySchedule } = require('../../utils/weeklySchedule');
const { sendWorkbook } = require('../../utils/xlsxExport');
const { aboutSheet } = require('../../utils/aboutSheet');

// Shared by /performance and /performance/export: per active member, personal
// total, weekly-schedule consistency (personal weekly types only — group
// funds like Chai don't reflect individual effort), and pending fines.
async function computePerformance() {
  const [members, personalWeeklyTypes, excludedTypeIds, settings] = await Promise.all([
    Member.find({ active: true }).sort({ name: 1 }).lean(),
    ContributionType.find({ isWeekly: true, isGroupFund: false, active: true }).lean(),
    nonPersonalTypeIds(),
    getOrCreateSettings(),
  ]);
  const config = resolveConfig(settings);

  const memberIds = members.map((m) => m._id);
  const [contributions, pendingFines] = await Promise.all([
    Contribution.find({ memberId: { $in: memberIds }, deleted: false })
      .select('memberId typeId amount grossAmount fineDeducted date')
      .lean(),
    Fine.aggregate([
      { $match: { memberId: { $in: memberIds }, deleted: false, remaining: { $gt: 0 } } },
      { $group: { _id: '$memberId', total: { $sum: '$remaining' } } },
    ]),
  ]);

  const excludedSet = new Set(excludedTypeIds.map(String));
  const finesMap = new Map(pendingFines.map((f) => [String(f._id), f.total]));
  const contribByMember = new Map();
  for (const c of contributions) {
    const key = String(c.memberId);
    if (!contribByMember.has(key)) contribByMember.set(key, []);
    contribByMember.get(key).push(c);
  }

  const rows = members.map((member) => {
    const own = contribByMember.get(String(member._id)) || [];
    // All time means all time: what he brought in when the books opened (his
    // verified paper-ledger balance) plus everything logged against him since.
    // Without the carried-forward figure every member reads Ksh 1,400 on the day
    // the cycle starts, while holding a hundred thousand.
    const collected = own
      .filter((c) => !excludedSet.has(String(c.typeId)))
      .reduce((sum, c) => sum + c.amount, 0);
    const carriedIn = Number(member.openingBalance) || 0;
    const totalContributed = carriedIn + collected;
    const lastContributionDate = own.reduce(
      (latest, c) => (!latest || c.date > latest ? c.date : latest),
      null
    );

    let weeksExpected = 0;
    let weeksPaid = 0;
    let weeksPartial = 0;
    let weeksUnpaid = 0;
    // And what he has put in against the week that is RUNNING.
    //
    // This exists because the figures above answer a different question, and for the first
    // weeks of a cycle they answer nothing at all: `weeksExpected` counts only weeks that have
    // closed and been scored, and by design the opening week is the baseline (never scored) and
    // the week running now is not scored either (its Thursday is to come). So between go-live
    // and the first Thursday after it, every member reads 0/0 with a consistency of "—" while
    // the ledger and the passbook show money coming in — a report that looks broken on the one
    // day somebody is most likely to be looking at it.
    //
    // The running week is the only week a member can pay into today, so it is the only figure
    // that can answer "has he paid this week?".
    let paidThisWeek = 0;
    let runningWeek = null;
    for (const type of personalWeeklyTypes) {
      const typeContributions = own.filter((c) => String(c.typeId) === String(type._id));
      const weeks = buildWeeklySchedule(config, (w) => weeklyAmountForWeek(config, w), typeContributions);
      // The opening week is the baseline: it carried no expectation and no
      // payment, so counting it would drag every member's consistency down and
      // report a week nobody could have paid. The week still running is not
      // expected of anybody yet either — its Thursday is to come — which is the
      // same rule the 1,400 and the tea follow.
      const scored = weeks.filter((w) => !w.isBaseline && !w.isCurrent);
      const running = weeks.find((w) => w.isCurrent);
      if (running) {
        paidThisWeek += running.paid;
        runningWeek = running.weekNumber;
      }
      weeksExpected += scored.length;
      weeksPaid += scored.filter((w) => w.status === 'paid').length;
      weeksPartial += scored.filter((w) => w.status === 'partial').length;
      weeksUnpaid += scored.filter((w) => w.status === 'unpaid').length;
    }
    const consistency = weeksExpected > 0 ? Math.round((weeksPaid / weeksExpected) * 100) : null;

    return {
      memberId: member._id,
      name: member.name,
      regNumber: member.regNumber || null,
      phone: member.phone,
      totalContributed,
      // The two halves of that figure, so the screen can say which is which.
      carriedIn,
      collected,
      weeksExpected,
      weeksPaid,
      weeksPartial,
      weeksUnpaid,
      consistency,
      // The week running now, and what he has put against it: the only figures that
      // say anything about a member before the first Thursday of the cycle has passed.
      paidThisWeek,
      runningWeek,
      weeklyAmount: config.weeklyAmount,
      pendingFines: finesMap.get(String(member._id)) || 0,
      lastContributionDate,
    };
  });

  // Best performers first; members with no weekly schedule yet (consistency
  // null) sort to the bottom rather than being treated as 0%.
  rows.sort((a, b) => (b.consistency ?? -1) - (a.consistency ?? -1));
  return rows;
}

// GET /api/reports/performance — ranked member consistency (personal weekly
// types only) and pending fines, for spotting who's keeping up and who isn't.
async function performance(req, res, next) {
  try {
    const members = await computePerformance();
    res.json({ members, totals: performanceTotals(members) });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/performance/export — same data as an .xlsx workbook
async function exportPerformance(req, res, next) {
  try {
    const rows = await computePerformance();
    const totals = performanceTotals(rows);
    const sheetRows = rows.map((r) => ({
      Name: r.name,
      'Reg number': r.regNumber || '',
      Phone: r.phone,
      'Total contributed': r.totalContributed,
      // Before the cycle's first Thursday has passed there are no closed weeks at all, so
      // "Weeks expected" and "Weeks paid" are 0 for everybody and consistency is blank. The
      // running-week column is what says anything about a member in that window.
      'Paid this week (running)': r.paidThisWeek,
      'Weeks expected': r.weeksExpected,
      'Weeks paid': r.weeksPaid,
      'Weeks partial': r.weeksPartial,
      'Weeks unpaid': r.weeksUnpaid,
      'Consistency %': r.consistency ?? '',
      'Pending fines': r.pendingFines,
      'Last contribution': r.lastContributionDate
        ? new Date(r.lastContributionDate).toISOString().slice(0, 10)
        : '',
    }));
    sendWorkbook(res, 'member-performance.xlsx', [
      aboutSheet({
        name: 'Member performance',
        settings: await getOrCreateSettings(),
        req,
        counts: [['Members', rows.length]],
        notes:
          'One line per active member. "Total contributed" includes the balance he carried in ' +
          'when the books opened. "Weeks expected" and "Weeks paid" count only weeks that have ' +
          'CLOSED and been scored - the opening week is the baseline and the week still running is ' +
          'not scored either, so at the start of a cycle both are 0 for everybody and consistency ' +
          'is blank; "Paid this week (running)" is the figure that says something then.',
      }),
      { name: 'Performance', rows: sheetRows },
      {
        name: 'Totals',
        rows: [
          { Field: 'Members', Value: totals.members },
          { Field: 'Total contributed (all-time)', Value: totals.totalContributed },
          { Field: 'Carried in inside that', Value: totals.carriedIn },
          { Field: 'Average consistency (%)', Value: totals.averageConsistency ?? '' },
          { Field: 'Members fully paid', Value: totals.fullyPaidMembers },
          { Field: 'Members below 80%', Value: totals.membersBehind },
          { Field: 'Weeks paid / expected', Value: `${totals.weeksPaid} / ${totals.weeksExpected}` },
          { Field: 'Pending fines', Value: totals.pendingFines },
        ],
      },
    ]);
  } catch (err) {
    next(err);
  }
}

// The headings a committee reads above the ranking: how many members, what they
// have paid between them, how consistent they are, and what is still owed.
function performanceTotals(rows) {
  const scored = rows.filter((r) => r.consistency !== null);
  return {
    members: rows.length,
    totalContributed: rows.reduce((sum, r) => sum + r.totalContributed, 0),
    carriedIn: rows.reduce((sum, r) => sum + r.carriedIn, 0),
    averageConsistency: scored.length
      ? Math.round(scored.reduce((sum, r) => sum + r.consistency, 0) / scored.length)
      : null,
    fullyPaidMembers: scored.filter((r) => r.consistency === 100).length,
    membersBehind: scored.filter((r) => r.consistency < 80).length,
    pendingFines: rows.reduce((sum, r) => sum + r.pendingFines, 0),
    weeksPaid: rows.reduce((sum, r) => sum + r.weeksPaid, 0),
    weeksExpected: rows.reduce((sum, r) => sum + r.weeksExpected, 0),
  };
}

module.exports = {
  exportPerformance,
  performance,
};
