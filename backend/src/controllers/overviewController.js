const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const Contribution = require('../models/Contribution');
const { getOrCreateSettings } = require('../utils/settings');
const { carriedInTotals } = require('../utils/carriedIn');
const { fundBalance } = require('../utils/fundBalance');
const { bucketForType } = require('../utils/ledgerTypes');
const { resolveConfig, currentWeekNumber } = require('../utils/weekCycle');
const { totalFinesCollected } = require('../utils/finesCollected');

// GET /api/public/overview — PUBLIC, no phone number needed.
// Group-wide totals only: chama name, membership size, and what has been raised
// per fund. Deliberately contains no per-member data — no name, no balance, no
// phone. A member's own record is opened by proving his number (publicLookup),
// not by browsing anything.
async function publicOverview(req, res, next) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [settings, activeMembers, totalMembersEver, resignedCount, types, totals, thisWeekAgg, finesCollected] =
      await Promise.all([
        getOrCreateSettings(),
        Member.countDocuments({ active: true }),
        Member.countDocuments(),
        Member.countDocuments({ active: false, resignedAt: { $ne: null } }),
        ContributionType.find({ active: true }).sort({ name: 1 }).lean(),
        Contribution.aggregate([
          { $match: { deleted: false } },
          { $group: { _id: '$typeId', total: { $sum: '$amount' } } },
        ]),
        Contribution.aggregate([
          { $match: { deleted: false, date: { $gte: sevenDaysAgo } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        totalFinesCollected(),
      ]);

    const totalsMap = new Map(totals.map((t) => [String(t._id), t.total]));
    const byType = types.map((t) => ({
      name: t.name,
      description: t.description || '',
      totalContributed: totalsMap.get(String(t._id)) || 0,
    }));
    const collected = byType.reduce((sum, t) => sum + t.totalContributed, 0);
    // The money that was already on the books when the cycle opened — the
    // members' carried-forward balances and the funds' floats. "All-time" has to
    // mean it, or the public page tells every member that the years they paid
    // into the paper ledger never happened, and reads as if the group held
    // nothing but what this ledger has watched move.
    const carriedIn = await carriedInTotals();
    const totalContributed = collected + carriedIn.total;
    const thisWeekTotal = thisWeekAgg[0]?.total || 0;

    const expenseTypes = types.filter((t) => t.tracksExpenses);
    // The Tea Fund's income is derived, not logged: 100 a member for every week
    // the cycle has actually scored, plus whatever tea was collected for the weeks
    // before it opened (the one-time week-91 entry). Worked out here exactly the
    // way the member's page works it out, because the tea has already come off
    // every member's money — a fund list reading Chai 0 against a passbook that
    // shows the tea taken is the group reading two different books.
    const config = resolveConfig(settings);
    const chaiType = types.find((t) => bucketForType(t) === 'chai') || null;
    const weeksScored = Math.max(0, currentWeekNumber(config) - config.cycleStartWeek);
    const teaBeforeCycle = chaiType
      ? await Contribution.aggregate([
          { $match: { deleted: false, typeId: chaiType._id, date: { $lt: config.anchorDate } } },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$grossAmount', '$amount'] } } } },
        ])
      : [];
    const teaIncome = config.chaiAmount * weeksScored * activeMembers + (teaBeforeCycle[0]?.total || 0);

    const fundBalances = await Promise.all(
      expenseTypes.map(async (t) => {
        const derived = bucketForType(t) === 'chai' ? teaIncome : 0;
        return {
          name: t.name,
          // The part of the balance that was derived rather than collected — the
          // automatic tea — so a list can say so instead of showing a figure with
          // nothing behind it in the contribution rows.
          derived,
          // The fund's one-time carry-in (the tea float the group already held),
          // so a balance is what the fund actually holds, not just what this
          // ledger has watched move.
          ...(await fundBalance(t._id, { carriedIn: t.openingBalance, extraIncome: derived })),
        };
      })
    );
    const totalExpenses = fundBalances.reduce((sum, f) => sum + (f.spent || 0), 0);

    res.json({
      chamaName: settings.chamaName,
      activeMembers,
      totalMembersEver,
      resignedCount,
      byType,
      totalContributed,
      // Named parts: the members' brought-forward balances, the funds' floats, and
      // what this ledger has watched come in since the cycle opened.
      carriedIn: carriedIn.total,
      carriedInMemberBalances: carriedIn.memberBalances,
      carriedInFundFloats: carriedIn.fundFloats,
      collected,
      totalExpenses,
      // What the group actually holds right now: everything raised, minus
      // everything spent from expense-tracking funds. This is the number that
      // answers "how much money does the chama have?" — totalContributed alone
      // answers a different question (lifetime raised).
      netBalance: totalContributed - totalExpenses,
      thisWeekTotal,
      fundBalances,
      finesCollected,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { publicOverview };
