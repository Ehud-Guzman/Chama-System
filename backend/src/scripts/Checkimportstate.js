// Read-only diagnostic. Makes no writes. Reports what's actually in the
// database right now, so we know whether "Opening Balances" is the only
// thing missing, or whether the whole week 60 seed never landed.
//
// Usage:
//   node src/scripts/checkImportState.js

require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');
const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const Contribution = require('../models/Contribution');

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }

  // Print which URI we're actually pointed at (host/db name only — no
  // credentials) since "wrong database" is one of the things this is
  // trying to rule out.
  const safeUri = process.env.MONGO_URI.replace(/\/\/[^@]*@/, '//<credentials>@');
  console.log(`MONGO_URI: ${safeUri}\n`);

  await mongoose.connect(process.env.MONGO_URI);

  const admin = await User.findOne({ role: 'super_admin' });
  console.log(`Super admin: ${admin ? `found (${admin.email || admin._id})` : 'NOT FOUND'}`);

  const typeNames = [
    'Weekly Contribution',
    'Chai',
    'Fines & Penalties',
    'Registration Fees',
    'Resignation Fines',
  ];

  console.log('\nContribution types:');
  for (const name of typeNames) {
    const type = await ContributionType.findOne({ name });
    console.log(`  ${name}: ${type ? 'exists' : 'MISSING'}`);
  }

  const totalMembers = await Member.countDocuments({});
  const openingBalances = await Member.findOne({ name: 'Opening Balances' });
  const realMembers = await Member.countDocuments({ name: { $ne: 'Opening Balances' } });

  console.log(`\nMembers total: ${totalMembers}`);
  console.log(`  "Opening Balances" system member: ${openingBalances ? 'exists' : 'MISSING'}`);
  console.log(`  Other (real) members: ${realMembers}`);

  const totalContributions = await Contribution.countDocuments({});
  console.log(`\nContributions total: ${totalContributions}`);

  console.log('\n--- Summary ---');
  if (totalMembers === 0) {
    console.log('Member collection is completely empty. The week 60 seed never landed here (or got wiped since). Re-run importWeek60Ledger.js --confirm-wipe against this database.');
  } else if (!openingBalances) {
    console.log(`${realMembers} real member(s) exist, but "Opening Balances" is missing. Likely a partial/crashed run. Needs the system member created on its own — don't re-wipe, that would delete the real members and contributions that ARE here.`);
  } else {
    console.log('Everything looks present. If importLedgerIncremental.js still fails, something else is going on — worth re-checking the exact MONGO_URI it\'s using at runtime.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});