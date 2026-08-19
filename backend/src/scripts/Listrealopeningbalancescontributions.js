// Read-only. No writes. Lists every Contribution attached to the real
// "Opening Balances" member, so you can compare it against
// listStrayMemberContributions.js's output and check for overlap in
// weeks 62-67 (Fines & Penalties, Chai/Tea Balance, Registration,
// Resignation) — the same categories the stray member has entries for.
//
// Usage:
//   node src/scripts/listRealOpeningBalancesContributions.js

require('dotenv').config();

const mongoose = require('mongoose');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const real = await Member.findOne({ name: 'Opening Balances' });
  if (!real) {
    console.log('Real "Opening Balances" member not found.');
    await mongoose.disconnect();
    return;
  }

  const contributions = await Contribution.find({ memberId: real._id }).sort({ date: 1 });
  const typeIds = [...new Set(contributions.map((c) => String(c.typeId)))];
  const types = await ContributionType.find({ _id: { $in: typeIds } });
  const typeNameById = new Map(types.map((t) => [String(t._id), t.name]));

  console.log(`${contributions.length} contribution(s) on real "Opening Balances":\n`);

  let total = 0;
  for (const c of contributions) {
    const typeName = typeNameById.get(String(c.typeId)) || '(unknown type)';
    console.log(`  ${c.date.toISOString().slice(0, 10)}  ${typeName.padEnd(22)} Ksh ${c.amount}  — ${c.note || '(no note)'}`);
    total += c.amount;
  }

  console.log(`\nTotal: Ksh ${total}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});