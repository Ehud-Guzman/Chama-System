const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const Contribution = require('../models/Contribution');
const { getOrCreateSettings } = require('../utils/settings');

// GET /api/public/overview — PUBLIC, no phone number needed.
// Group-wide transparency: chama name, membership size, and totals raised
// per contribution type. Deliberately contains no per-member data.
async function publicOverview(req, res, next) {
  try {
    const [settings, activeMembers, totalMembersEver, types, totals] = await Promise.all([
      getOrCreateSettings(),
      Member.countDocuments({ active: true }),
      Member.countDocuments(),
      ContributionType.find({ active: true }).sort({ name: 1 }).lean(),
      Contribution.aggregate([
        { $match: { deleted: false } },
        { $group: { _id: '$typeId', total: { $sum: '$amount' } } },
      ]),
    ]);

    const totalsMap = new Map(totals.map((t) => [String(t._id), t.total]));
    const byType = types.map((t) => ({
      name: t.name,
      description: t.description || '',
      totalContributed: totalsMap.get(String(t._id)) || 0,
    }));
    const totalContributed = byType.reduce((sum, t) => sum + t.totalContributed, 0);

    res.json({
      chamaName: settings.chamaName,
      activeMembers,
      totalMembersEver,
      byType,
      totalContributed,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { publicOverview };
