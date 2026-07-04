const mongoose = require('mongoose');
const ContributionType = require('../models/ContributionType');
const Pledge = require('../models/Pledge');
const Contribution = require('../models/Contribution');

// Per-member breakdown across every contribution type: pledged vs. contributed.
// Includes all active types (even untouched ones, so members can see the full
// picture of what the group tracks) plus any inactive type the member has
// historical pledges/contributions against.
async function typeBreakdown(memberId) {
  const id = new mongoose.Types.ObjectId(memberId);
  const [types, pledges, sums] = await Promise.all([
    ContributionType.find().lean(),
    Pledge.find({ memberId: id }).lean(),
    Contribution.aggregate([
      { $match: { memberId: id, deleted: false } },
      { $group: { _id: '$typeId', total: { $sum: '$amount' } } },
    ]),
  ]);

  const pledgeMap = new Map(pledges.map((p) => [String(p.typeId), p.amount]));
  const sumMap = new Map(sums.map((s) => [String(s._id), s.total]));

  return types
    .filter((t) => t.active || pledgeMap.has(String(t._id)) || sumMap.has(String(t._id)))
    .map((t) => ({
      typeId: t._id,
      name: t.name,
      pledged: pledgeMap.get(String(t._id)) || 0,
      contributed: sumMap.get(String(t._id)) || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { typeBreakdown };
