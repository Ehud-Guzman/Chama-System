const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');

// What each member's own money currently reads as on the ledger.
//
// Group-fund money (Tea, registration, projects, the old fines and opening
// balances) belongs to the Group, so it can never be part of a member's
// carry-forward figure. grossAmount is preferred over amount so a payment that
// was partly redirected to settle a fine still counts as cash received.
//
// Shared by the go-live setup screen and the Week-92 reset script: the figure
// the treasurer is shown and the figure the migration writes must be the same
// number, and one function is the only way to be sure of that.
async function suggestedOpeningBalances(memberIds) {
  const [types, contributions] = await Promise.all([
    ContributionType.find().select('isGroupFund').lean(),
    Contribution.find({
      deleted: false,
      ...(memberIds ? { memberId: { $in: memberIds } } : {}),
    })
      .select('memberId typeId amount grossAmount')
      .lean(),
  ]);

  const typeById = new Map(types.map((t) => [String(t._id), t]));
  const held = new Map();
  for (const c of contributions) {
    const type = typeById.get(String(c.typeId));
    if (!type || type.isGroupFund) continue;
    const key = String(c.memberId);
    const cash = Number(c.grossAmount ?? c.amount) || 0;
    held.set(key, (held.get(key) || 0) + cash);
  }

  // Rounded to the cent: a bank-interest line carried two decimal places and
  // nothing here needs more than that.
  for (const [key, value] of held) held.set(key, Math.round(value * 100) / 100);
  return held;
}

module.exports = { suggestedOpeningBalances };
