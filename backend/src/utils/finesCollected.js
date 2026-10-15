const Fine = require('../models/Fine');

// Total cash actually collected against fines — both auto-deducted from a
// contribution and manually settled. This money is real and held by the
// group, but it never appears as a Contribution (fines aren't a
// ContributionType), so every "total contributed" figure undercounts actual
// cash on hand by exactly this amount unless it's surfaced separately.
//
// A fine taken out of a member's balance is NOT new cash: the money was already in
// the group's hands (it is inside the contributions) and only changed from being his
// to being the group's. Counting it here would count it twice, so it is left out.
async function totalFinesCollected() {
  const rows = await Fine.aggregate([
    { $match: { deleted: false } },
    { $unwind: '$settlements' },
    { $match: { 'settlements.source': { $ne: 'balance' } } },
    { $group: { _id: null, total: { $sum: '$settlements.amount' } } },
  ]);
  return rows[0]?.total || 0;
}

module.exports = { totalFinesCollected };
