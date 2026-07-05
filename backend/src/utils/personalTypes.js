const ContributionType = require('../models/ContributionType');

// IDs of contribution types flagged isGroupFund — money collected under these
// (e.g. Chai) belongs to the group, not the individual, so every per-member
// "total contributed" figure must exclude them even though the contribution
// itself still appears on the member's ledger.
async function nonPersonalTypeIds() {
  return ContributionType.distinct('_id', { isGroupFund: true });
}

module.exports = { nonPersonalTypeIds };
