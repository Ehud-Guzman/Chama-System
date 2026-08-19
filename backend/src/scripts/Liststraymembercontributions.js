// Read-only. No writes. Lists every Contribution attached to the stray
// "Opening Balances (Paper Ledger)" member (_id 6a803bf555b80768a54bc9bc)
// so you can see exactly what's there before deciding whether to delete,
// reassign, or leave it.
//
// Usage:
//   node src/scripts/listStrayMemberContributions.js

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

  const stray = await Member.findOne({ name: 'Opening Balances (Paper Ledger)' });
  if (!stray) {
    console.log('That member no longer exists.');
    await mongoose.disconnect();
    return;
  }

  const contributions = await Contribution.find({ memberId: stray._id }).sort({ date: 1 });
  const typeIds = [...new Set(contributions.map((c) => String(c.typeId)))];
  const types = await ContributionType.find({ _id: { $in: typeIds } });
  const typeNameById = new Map(types.map((t) => [String(t._id), t.name]));

  console.log(`${contributions.length} contribution(s) on "Opening Balances (Paper Ledger)":\n`);

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