const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const Contribution = require('../models/Contribution');
const { getOrCreateSettings } = require('../utils/settings');
const { fundBalance } = require('../utils/fundBalance');
const { totalFinesCollected } = require('../utils/finesCollected');

// GET /api/public/overview — PUBLIC, no phone number needed.
// Group-wide transparency: chama name, membership size, and totals raised
// per contribution type. Deliberately contains no per-member data.
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
    const totalContributed = byType.reduce((sum, t) => sum + t.totalContributed, 0);
    const thisWeekTotal = thisWeekAgg[0]?.total || 0;

    const expenseTypes = types.filter((t) => t.tracksExpenses);
    const fundBalances = await Promise.all(
      expenseTypes.map(async (t) => ({ name: t.name, ...(await fundBalance(t._id)) }))
    );

    res.json({
      chamaName: settings.chamaName,
      constitution: settings.constitution || '',
      activeMembers,
      totalMembersEver,
      resignedCount,
      byType,
      totalContributed,
      thisWeekTotal,
      fundBalances,
      // Fines paid (auto-deducted from a contribution or settled manually)
      // are real cash the group holds but never appear as a Contribution —
      // shown separately so "total contributed" isn't mistaken for total cash.
      finesCollected,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { publicOverview };
