const mongoose = require('mongoose');
const ContributionType = require('../models/ContributionType');
const Contribution = require('../models/Contribution');

// Per-member breakdown across every contribution type: what he has actually paid
// into each one.
//
// This used to carry a "pledged" figure as well — what the member promised. Pledges
// are gone from the system: the group works to the constitution's fixed weekly
// amount and the funds it keeps, and a promise nobody logs a payment against told
// the member's page a story the books could not back.
//
// Includes all active types (even untouched ones, so a member can see the full
// picture of what the group tracks) plus any inactive type he has contributions
// against, so history never disappears.
async function typeBreakdown(memberId) {
  const id = new mongoose.Types.ObjectId(memberId);
  const [types, sums] = await Promise.all([
    ContributionType.find().lean(),
    Contribution.aggregate([
      { $match: { memberId: id, deleted: false } },
      { $group: { _id: '$typeId', total: { $sum: '$amount' } } },
    ]),
  ]);

  const sumMap = new Map(sums.map((s) => [String(s._id), s.total]));

  return types
    .filter((t) => t.active || sumMap.has(String(t._id)))
    .map((t) => ({
      typeId: t._id,
      name: t.name,
      // Carried so a caller can keep the Group's own funds out of a view meant for
      // the member himself (the passbook hides the Tea Fund; the office's screens
      // show it).
      isGroupFund: Boolean(t.isGroupFund),
      contributed: sumMap.get(String(t._id)) || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { typeBreakdown };

