const ContributionType = require('../models/ContributionType');

// The only contribution types the system still maintains. The treasurer's
// ledger works in exactly three buckets, so there is nothing for anyone to
// configure: the weekly requirement and the tea amount are governance figures
// that live in Settings (constitution §7.1, §7.2), and these type rows exist
// only so each payment has somewhere to hang.
const WEEKLY_TYPE_NAME = 'Weekly Contribution';
const CHAI_TYPE_NAME = 'Chai';
const EXTRA_TYPE_NAME = 'Extra Contributions';

const LEDGER_TYPE_NAMES = [WEEKLY_TYPE_NAME, CHAI_TYPE_NAME, EXTRA_TYPE_NAME];

const LEDGER_TYPES = [
  {
    name: WEEKLY_TYPE_NAME,
    description: 'The mandatory weekly personal contribution (§7.1). Counts toward the member own money.',
    isWeekly: true,
    isGroupFund: false,
    tracksExpenses: false,
  },
  {
    name: CHAI_TYPE_NAME,
    description: 'Tea Fund — belongs to the Group, spent on meeting refreshments (§7.2). Never mixed into a member personal total.',
    isWeekly: true,
    isGroupFund: true,
    tracksExpenses: true,
  },
  {
    name: EXTRA_TYPE_NAME,
    description: 'Anything a member pays above the weekly requirement. Saved to the member, not the Group.',
    isWeekly: false,
    isGroupFund: false,
    tracksExpenses: false,
  },
];

// Idempotent, like seedDisciplinaryFineTypes: safe to run on every boot, and it
// never touches a type that already exists so historical rows keep their _id.
async function seedLedgerTypes() {
  for (const type of LEDGER_TYPES) {
    await ContributionType.updateOne(
      { name: type.name },
      { $setOnInsert: { ...type, active: true } },
      { upsert: true }
    );
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

// Resolves the three buckets for the ledger engine. Missing types are created
// on the spot so a fresh database (or one just wiped back to nothing) works
// without a separate migration step.
async function getLedgerTypes() {
  await seedLedgerTypes();
  const types = await ContributionType.find({ name: { $in: LEDGER_TYPE_NAMES } }).lean();
  const byName = new Map(types.map((t) => [t.name, t]));
  return {
    weekly: byName.get(WEEKLY_TYPE_NAME),
    chai: byName.get(CHAI_TYPE_NAME),
    extra: byName.get(EXTRA_TYPE_NAME),
  };
}

// Which bucket a contribution belongs to, from its (possibly populated) typeId.
function bucketForType(type) {
  if (!type) return 'other';
  const name = typeof type === 'string' ? type : type.name;
  if (name === WEEKLY_TYPE_NAME) return 'weekly';
  if (name === CHAI_TYPE_NAME) return 'chai';
  if (name === EXTRA_TYPE_NAME) return 'extra';
  return 'other';
}

module.exports = {
  WEEKLY_TYPE_NAME,
  CHAI_TYPE_NAME,
  EXTRA_TYPE_NAME,
  LEDGER_TYPE_NAMES,
  LEDGER_TYPES,
  seedLedgerTypes,
  syncLedgerTypeAmounts,
  getLedgerTypes,
  bucketForType,
};
