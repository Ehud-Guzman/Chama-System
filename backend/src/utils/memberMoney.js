const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const { bucketForType } = require('./ledgerTypes');
const { computeMemberLedger } = require('./memberLedger');
const { resolveConfig } = require('./weekCycle');
const { getOrCreateSettings } = require('./settings');

// One member's position from the cycle engine, read on its own.
//
// The fines desk needs a single member's held money at the moment a fine is about to be taken
// out of it: how much does the group hold for him, so that the office is never offered (or
// allowed) a deduction bigger than that? Every screen that lists balances loads whole sets of
// members and contributions for itself; this is the same load for one member, so the figure a
// deduction is checked against is the figure his own passbook prints, from the same engine.
//
// `session` is passed through so the check can run inside the transaction that writes the
// deduction — otherwise two payments landing together would each be checked against the balance
// as it stood before either.
async function memberLedgerNow(memberId, { session } = {}) {
  const [member, types, contributions, settings] = await Promise.all([
    Member.findById(memberId).session(session || null).lean(),
    ContributionType.find().select('name isGroupFund isWeekly').lean(),
    Contribution.find({ memberId, deleted: false })
      .select('typeId amount grossAmount fineDeducted date')
      .session(session || null)
      .lean(),
    getOrCreateSettings(),
  ]);
  if (!member) return null;

  const typeById = new Map(types.map((t) => [String(t._id), t]));
  const annotated = contributions.map((c) => {
    const type = typeById.get(String(c.typeId));
    return { ...c, bucket: bucketForType(type), isGroupFund: Boolean(type && type.isGroupFund) };
  });

  return computeMemberLedger({ member, contributions: annotated, config: resolveConfig(settings) });
}

module.exports = { memberLedgerNow };
