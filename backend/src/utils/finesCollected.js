const Fine = require('../models/Fine');

// Total cash actually collected against fines — both auto-deducted from a
// contribution and manually settled. This money is real and held by the
// group, but it never appears as a Contribution (fines aren't a
// ContributionType), so every "total contributed" figure undercounts actual
// cash on hand by exactly this amount unless it's surfaced separately.
async function totalFinesCollected() {
  const rows = await Fine.aggregate([
    { $match: { deleted: false } },
    { $unwind: '$settlements' },
    { $group: { _id: null, total: { $sum: '$settlements.amount' } } },
  ]);
  return rows[0]?.total || 0;
}

module.exports = { totalFinesCollected };
