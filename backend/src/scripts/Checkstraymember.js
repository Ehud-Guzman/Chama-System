// Read-only. No writes. Checks whether "Opening Balances (Paper Ledger...)"
// (phone 0700000000) has any Contributions or Fines pointing at its Member
// ID, so you know whether it's safe to delete or whether removing it would
// orphan real data.
//
// Usage:
//   node src/scripts/checkStrayMember.js

require('dotenv').config();

const mongoose = require('mongoose');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const Fine = require('../models/Fine');

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const candidates = await Member.find({
    name: { $regex: /Opening Balances/i },
  });

  console.log(`Found ${candidates.length} member(s) matching "Opening Balances":\n`);

  for (const m of candidates) {
    console.log(`- "${m.name}" (_id: ${m._id}, phone: ${m.phone}, active: ${m.active})`);

    const contributions = await Contribution.countDocuments({ memberId: m._id });
    const fines = await Fine.countDocuments({ memberId: m._id });

    console.log(`    Contributions: ${contributions}`);
    console.log(`    Fines: ${fines}`);
    console.log('');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});