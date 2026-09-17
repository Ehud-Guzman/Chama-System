const ContributionType = require('../models/ContributionType');
const Contribution = require('../models/Contribution');

// The only contribution types the system still maintains. The treasurer's
// ledger works in exactly three buckets, so there is nothing for anyone to
// configure: the weekly requirement and the tea amount are governance figures
// that live in Settings (constitution §7.1, §7.2), and these type rows exist
// only so each payment has somewhere to hang.
const WEEKLY_TYPE_NAME = 'Weekly Contribution';
const CHAI_TYPE_NAME = 'Chai';
// Retired: "Extra Contributions" is gone — anything a member pays above the
// weekly requirement is simply a bigger weekly payment, which the cumulative
// credit already carries forward. Kept as a name so the seed can clear the type
// out of a database that still has one.
const RETIRED_EXTRA_TYPE_NAME = 'Extra Contributions';

const LEDGER_TYPE_NAMES = [WEEKLY_TYPE_NAME, CHAI_TYPE_NAME];

const LEDGER_TYPES = [
  {
    name: WEEKLY_TYPE_NAME,
    description: 'The weekly personal contribution (§7.1). Counts toward the member own money.',
    isWeekly: true,
    isGroupFund: false,
    tracksExpenses: false,
  },
  {
    name: CHAI_TYPE_NAME,
    description: 'Tea Fund — 100 a week is deducted from every member automatically and belongs to the Group (§7.2). The type exists so Tea Fund spending has something to attach to; no tea is ever logged against it.',
    isWeekly: true,
    isGroupFund: true,
    tracksExpenses: true,
  },
];

// Idempotent, like seedDisciplinaryFineTypes: safe to run on every boot, and it
// never touches a type that already exists so historical rows keep their _id.
// It also clears out the retired "Extra Contributions" type, but only while
// nothing points at it — a database that still has extra rows depends on it.
async function seedLedgerTypes() {
  for (const type of LEDGER_TYPES) {
    await ContributionType.updateOne(
      { name: type.name },
      { $setOnInsert: { ...type, active: true } },
      { upsert: true }
    );
  }
  const retired = await ContributionType.findOne({ name: RETIRED_EXTRA_TYPE_NAME });
  if (retired) {
    const used = await Contribution.countDocuments({ typeId: retired._id, deleted: false });
    if (used === 0) await ContributionType.deleteOne({ _id: retired._id });
  }
}

// The legacy screens (weekly grid, reports, member schedule) still read each
// type own weeklyAmount, so Settings stays authoritative and these two copies
// are kept in step with it. Called on boot and whenever the figures change.
async function syncLedgerTypeAmounts(settings) {
  await Promise.all([
    ContributionType.updateOne({ name: WEEKLY_TYPE_NAME }, { $set: { weeklyAmount: settings.weeklyAmount } }),
    ContributionType.updateOne({ name: CHAI_TYPE_NAME }, { $set: { weeklyAmount: settings.chaiAmount } }),
  ]);
}

// Which bucket a contribution belongs to, from its (possibly populated) typeId.
// 'extra' is kept for rows logged before the type was retired: they are money the
// member genuinely paid, so they still count as his.
function bucketForType(type) {
  if (!type) return 'other';
  const name = typeof type === 'string' ? type : type.name;
  if (name === WEEKLY_TYPE_NAME) return 'weekly';
  if (name === CHAI_TYPE_NAME) return 'chai';
  if (name === RETIRED_EXTRA_TYPE_NAME) return 'extra';
  return 'other';
}

// The three buckets the ledger works in. getLedgerTypes() resolves the two that
// still exist; `extra` is deliberately absent because nothing writes one now.
async function getLedgerTypes() {
  await seedLedgerTypes();
  const types = await ContributionType.find({ name: { $in: LEDGER_TYPE_NAMES } }).lean();
  const byName = new Map(types.map((t) => [t.name, t]));
  return {
    weekly: byName.get(WEEKLY_TYPE_NAME),
    chai: byName.get(CHAI_TYPE_NAME),
  };
}

module.exports = {
  WEEKLY_TYPE_NAME,
  CHAI_TYPE_NAME,
  RETIRED_EXTRA_TYPE_NAME,
  LEDGER_TYPE_NAMES,
  LEDGER_TYPES,
  seedLedgerTypes,
  syncLedgerTypeAmounts,
  getLedgerTypes,
  bucketForType,
};
