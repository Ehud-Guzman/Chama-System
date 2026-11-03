// The reports controller, part: summary. controllers/reportController.js is the index the routes use.

const ContributionType = require('../../models/ContributionType');
const Contribution = require('../../models/Contribution');
const Member = require('../../models/Member');
const Fine = require('../../models/Fine');
const { currentWeekNumber, weekRange, resolveConfig } = require('../../utils/weekCycle');
const { summariseWeekProgress } = require('../../utils/weekProgress');
const { getOrCreateSettings } = require('../../utils/settings');
const { totalFinesCollected } = require('../../utils/finesCollected');
const { computeMoneyPosition } = require('../../utils/moneyPosition');

// The week the group is in, and the money that has come in inside it: the card the summary opens
// with, and the "this week" section of the printed meeting report. One function, so the screen and
// the page somebody hands round at the meeting cannot quote two different weeks.
//
// The week's asking is the weekly amount times the active roster; what has come in is the weekly
// contributions dated inside the week; the rest is arithmetic over the two (utils/weekProgress,
// where the rule and its checks live).
async function computeThisWeek(config) {
  const weekNumber = currentWeekNumber(config);
  const week = weekRange(weekNumber, config);
  // The personal weekly types: his own 1,400, as against the tea and other group funds collected
  // in the same week. A member who has brought his 1,400 has brought it whatever else came with it,
  // and one who has only bought tea has not brought it at all.
  const weeklyTypeIds = await ContributionType.find({ isWeekly: true, isGroupFund: false })
    .select('_id')
    .lean()
    .then((rows) => rows.map((row) => row._id));

  const [weekPayments, activeIds] = await Promise.all([
    // One line per member who has put anything in this week: what the week's card reads. The
    // weekly contribution only (see weeklyTypeIds above).
    Contribution.aggregate([
      {
        $match: {
          deleted: false,
          typeId: { $in: weeklyTypeIds },
          date: { $gte: week.startDate, $lte: week.endDate },
        },
      },
      {
        $group: {
          _id: '$memberId',
          // Gross cash, so a payment that was partly redirected to a fine still counts as the
          // money he handed over — the same rule the ledger follows.
          paid: { $sum: { $ifNull: ['$grossAmount', '$amount'] } },
        },
      },
    ]),
    Member.find({ active: true }).select('_id').lean(),
  ]);

  return {
    weekNumber,
    startDate: week.startDate,
    endDate: week.endDate,
    weeklyAmount: config.weeklyAmount,
    ...summariseWeekProgress({
      rows: weekPayments,
      activeMemberIds: activeIds.map((m) => m._id),
      expected: config.weeklyAmount * activeIds.length,
      weeklyAmount: config.weeklyAmount,
    }),
  };
}

// GET /api/reports/summary — total, per-method breakdown, zero-contribution
// member count, and net cash balance after tracked fund expenses.
async function summary(req, res, next) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const settings = await getOrCreateSettings();
    const config = resolveConfig(settings);
    const [byMethod, byTypeRaw, activeMembers, contributingIds, thisWeekAgg, finesCollected, position, thisWeek] =
      await Promise.all([
        Contribution.aggregate([
          { $match: { deleted: false } },
          { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        Contribution.aggregate([
          { $match: { deleted: false } },
          { $group: { _id: '$typeId', total: { $sum: '$amount' }, count: { $sum: 1 } } },
          { $lookup: { from: 'contributiontypes', localField: '_id', foreignField: '_id', as: 'type' } },
          { $unwind: '$type' },
          { $project: { _id: 0, typeId: '$_id', name: '$type.name', total: 1, count: 1 } },
          { $sort: { total: -1 } },
        ]),
        Member.countDocuments({ active: true }),
        Contribution.distinct('memberId', { deleted: false }),
        Contribution.aggregate([
          { $match: { deleted: false, date: { $gte: sevenDaysAgo } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        totalFinesCollected(),
        // Everything down to the net balance: money in (all time, carry-in included),
        // money spent out of the funds, and what is left. Shared with the expenses
        // screen and its report (utils/moneyPosition).
        computeMoneyPosition(),
        // Where this week stands — the card the summary opens with.
        computeThisWeek(config),
      ]);

    const totalCount = byMethod.reduce((sum, m) => sum + m.count, 0);

    // What the members put in before this ledger existed is real money — the paper
    // ledger's own totals, verified member by member at go-live — so the all-time
    // figure carries it. `collected` is the row total kept apart, because the
    // per-method and per-type breakdowns below it are rows and nothing else.
    const { carriedIn, collected, totalContributed: allTime, totalExpenses, netBalance, funds } =
      position;

    const contributingActive = await Member.countDocuments({
      _id: { $in: contributingIds },
      active: true,
    });

    // The office's fines position, all time. Kept beside the contribution figures
    // because a committee asks the three questions together: what came in, what is
    // in the funds, and what is still owed in fines.
    const [fineAgg, fineByType] = await Promise.all([
      Fine.aggregate([
        { $match: { deleted: false } },
        {
          $group: {
            _id: null,
            issued: { $sum: '$amount' },
            remaining: { $sum: '$remaining' },
            count: { $sum: 1 },
            pendingCount: { $sum: { $cond: [{ $gt: ['$remaining', 0] }, 1, 0] } },
          },
        },
      ]),
      Fine.aggregate([
        { $match: { deleted: false } },
        { $group: { _id: '$typeId', issued: { $sum: '$amount' }, remaining: { $sum: '$remaining' }, count: { $sum: 1 } } },
        { $lookup: { from: 'finetypes', localField: '_id', foreignField: '_id', as: 'type' } },
        { $unwind: '$type' },
        {
          $project: {
            _id: 0,
            name: '$type.name',
            category: '$type.category',
            issued: 1,
            remaining: 1,
            count: 1,
          },
        },
        { $sort: { remaining: -1 } },
      ]),
    ]);

    const finesSummary = {
      issued: fineAgg[0]?.issued || 0,
      outstanding: fineAgg[0]?.remaining || 0,
      cleared: (fineAgg[0]?.issued || 0) - (fineAgg[0]?.remaining || 0),
      count: fineAgg[0]?.count || 0,
      pendingCount: fineAgg[0]?.pendingCount || 0,
      clearedCount: (fineAgg[0]?.count || 0) - (fineAgg[0]?.pendingCount || 0),
      collected: finesCollected,
      byType: fineByType,
    };

    res.json({
      thisWeek,
      totalContributed: allTime,
      // Named parts, so a screen can show what the total is made of rather than
      // leaving the difference to be guessed at.
      carriedIn: carriedIn.total,
      carriedInMemberBalances: carriedIn.memberBalances,
      carriedInFundFloats: carriedIn.fundFloats,
      carriedInInactiveBalances: carriedIn.inactiveMemberBalances,
      carriedInInactiveMembers: carriedIn.inactiveMembers,
      collected,
      totalExpenses,
      // Everything raised, all time, less what has been spent from
      // expense-tracking funds (e.g. Chai) — the group's money on hand. It is
      // the all-time total that answers that question, not the row total.
      netBalance,
      // The group's own funds added up — spending already taken off each of them, and
      // the members' carried-in balances deliberately not in it (that money is held for
      // them). The same figure the spending screen and its report quote.
      groupFund: position.groupFund,
      thisWeekTotal: thisWeekAgg[0]?.total || 0,
      contributionCount: totalCount,
      activeMembers,
      membersWithZeroContributions: activeMembers - contributingActive,
      byMethod: byMethod
        .map((m) => ({ method: m._id, total: m.total, count: m.count }))
        .sort((a, b) => b.total - a.total),
      byType: byTypeRaw,
      // Cash collected against fines never shows up as a Contribution — kept
      // separate from totalContributed so it isn't mistaken for total cash held.
      finesCollected,
      // What is owed in fines, by type, beside what has been collected — the two
      // halves of the same story, and the figures a committee asks for by name.
      fines: finesSummary,
      // What each fund holds today, carry-in and automatic tea included.
      funds,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  computeThisWeek,
  summary,
};
