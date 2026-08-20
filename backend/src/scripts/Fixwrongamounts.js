// Applies the exact corrections found by findWrongAmounts.js — either
// fixing a contribution's amount to match the ledger, or removing it
// entirely when the ledger says no contribution happened that week
// (expected = 0).
//
// This acts ONLY on the specific document IDs listed below, taken directly
// from the findWrongAmounts.js report — nothing is inferred or re-derived
// at run time, so there's no risk of matching a different document.
//
// SAFE BY DEFAULT: dry run unless you pass --confirm-cleanup.
//
// Usage:
//   node src/scripts/fixWrongAmounts.js                    (dry run)
//   node src/scripts/fixWrongAmounts.js --confirm-cleanup  (apply)

require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');
const Contribution = require('../models/Contribution');
const { logAudit, snapshot } = require('../utils/auditLogger');

const CONFIRMED = process.argv.includes('--confirm-cleanup');

// Taken directly from the findWrongAmounts.js report.
const CORRECTIONS = [
  { id: '6a81af326b83a56d588a48df', member: 'Victor Kamau',     week: 74, dbAmount: 27100, expected: 600 },
  { id: '6a81af3b6b83a56d588a4920', member: 'Joel Ndungu',      week: 74, dbAmount: 26000, expected: 52500 },
  { id: '6a81b0fa6b83a56d588a54e0', member: 'John Maina',       week: 83, dbAmount: 27000, expected: 2000 },
  { id: '6a81af3d6b83a56d588a492d', member: 'Benson Maina',     week: 74, dbAmount: 21500, expected: 1500 },
  { id: '6a81b0cc6b83a56d588a53ad', member: 'John Maina',       week: 82, dbAmount: 22000, expected: 2000 },
  { id: '6a81af666b83a56d588a4a42', member: 'Peter Kimotho',    week: 75, dbAmount: 10000, expected: 0 },
  { id: '6a81b0c56b83a56d588a5379', member: 'Stanly Gachara',   week: 82, dbAmount: 8500,  expected: 2500 },
  { id: '6a81af886b83a56d588a4b26', member: 'Isaac Njenga',     week: 75, dbAmount: 7500,  expected: 2000 },
  { id: '6a81b0ca6b83a56d588a53a0', member: 'Isaac Njenga',     week: 82, dbAmount: 2000,  expected: 7500 },
  { id: '6a81af336b83a56d588a48ec', member: 'Peter Kimotho',    week: 74, dbAmount: 5000,  expected: 0 },
  { id: '6a81b0cf6b83a56d588a53bd', member: 'Evans Ndungu',     week: 83, dbAmount: 4600,  expected: 1500 },
  { id: '6a81b0c26b83a56d588a5366', member: 'Isaiah Maina',     week: 82, dbAmount: 3000,  expected: 0 },
  { id: '6a81afef6b83a56d588a4dd8', member: 'Benard Ngugi',     week: 78, dbAmount: 2500,  expected: 0 },
  { id: '6a81b1666b83a56d588a57bb', member: 'Benson Maina',     week: 86, dbAmount: 5200,  expected: 3000 },
  { id: '6a81ad536b83a56d588a3c4b', member: 'John Maina',       week: 63, dbAmount: 2000,  expected: 0 },
  { id: '6a81ae6a6b83a56d588a439d', member: 'Erick Mwangi',     week: 69, dbAmount: 2000,  expected: 0 },
  { id: '6a81af6c6b83a56d588a4a69', member: 'John Gatimu',      week: 75, dbAmount: 2000,  expected: 0 },
  { id: '6a81af9e6b83a56d588a4bbb', member: 'Eustace Mugwanja', week: 76, dbAmount: 2000,  expected: 0 },
  { id: '6a81afc26b83a56d588a4caa', member: 'Joseph Ndegwa',    week: 77, dbAmount: 2000,  expected: 0 },
  { id: '6a81b0846b83a56d588a51c4', member: 'Erick Mwangi',     week: 81, dbAmount: 3000,  expected: 1000 },
  { id: '6a81b1706b83a56d588a57fb', member: 'Erick Mwangi',     week: 86, dbAmount: 5000,  expected: 3000 },
  { id: '6a81aefd6b83a56d588a4779', member: 'Joshua Maina',     week: 72, dbAmount: 3800,  expected: 2000 },
  { id: '6a81adce6b83a56d588a3f87', member: 'Benson Kaniu',     week: 66, dbAmount: 8490,  expected: 10100 },
  { id: '6a81b0446b83a56d588a501a', member: 'Ndungu Mbugua',    week: 80, dbAmount: 1600,  expected: 0 },
  { id: '6a81ad016b83a56d588a3a27', member: 'John Gatimu',      week: 62, dbAmount: 1500,  expected: 3000 },
  { id: '6a81af0b6b83a56d588a47da', member: 'David Njoroge',    week: 73, dbAmount: 1500,  expected: 0 },
  { id: '6a81afc06b83a56d588a4c9d', member: 'Ndungu Mbugua',    week: 77, dbAmount: 2500,  expected: 1000 },
  { id: '6a81b01a6b83a56d588a4efc', member: 'Ndungu Mbugua',    week: 79, dbAmount: 2900,  expected: 1400 },
  { id: '6a81b07c6b83a56d588a5190', member: 'Eustace Mugwanja', week: 81, dbAmount: 3000,  expected: 1500 },
  { id: '6a81ae026b83a56d588a40e5', member: 'Eustace Mugwanja', week: 67, dbAmount: 1000,  expected: 0 },
  { id: '6a81afad6b83a56d588a4c21', member: 'Dickson Karethi',  week: 76, dbAmount: 1000,  expected: 0 },
  { id: '6a81aff16b83a56d588a4de5', member: 'Ndungu Mbugua',    week: 78, dbAmount: 500,   expected: 1500 },
  { id: '6a81b0d96b83a56d588a5403', member: 'Samson Mwangi',    week: 83, dbAmount: 4200,  expected: 3200 },
  { id: '6a81b13e6b83a56d588a56ad', member: 'James Gachara',    week: 85, dbAmount: 500,   expected: 1500 },
  { id: '6a81ad336b83a56d588a3b73', member: 'Samson Mwangi',    week: 63, dbAmount: 2350,  expected: 1500 },
  { id: '6a81b15a6b83a56d588a5768', member: 'Ndungu Mbugua',    week: 86, dbAmount: 16900, expected: 17650 },
  { id: '6a81ade36b83a56d588a4015', member: 'Harrison Kamau',   week: 66, dbAmount: 500,   expected: 0 },
  { id: '6a81adec6b83a56d588a404f', member: 'John Maina',       week: 66, dbAmount: 1000,  expected: 1500 },
  { id: '6a81ae0c6b83a56d588a4125', member: 'Dennis Wasike',    week: 67, dbAmount: 10000, expected: 10500 },
  { id: '6a81aec36b83a56d588a45f6', member: 'James Gachara',    week: 71, dbAmount: 1700,  expected: 1200 },
  { id: '6a81adff6b83a56d588a40d2', member: 'Benson Maina',     week: 67, dbAmount: 1200,  expected: 1650 },
  { id: '6a81af4e6b83a56d588a499f', member: 'Dickson Karethi',  week: 74, dbAmount: 12400, expected: 12000 },
  { id: '6a81b1736b83a56d588a580e', member: 'Dennis Wasike',    week: 86, dbAmount: 2800,  expected: 2500 },
  { id: '6a81afa16b83a56d588a4bce', member: 'Wilson Kabichu',   week: 76, dbAmount: 6100,  expected: 6000 },
  { id: '6a81adee6b83a56d588a405f', member: 'Evans Ndungu',     week: 67, dbAmount: 4050,  expected: 4000 },
];

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected. Mode:', CONFIRMED ? 'APPLY' : 'DRY RUN (no changes)');
  console.log(`${CORRECTIONS.length} corrections queued.\n`);

  const admin = CONFIRMED ? await User.findOne({ role: 'super_admin' }) : null;
  if (CONFIRMED && !admin) {
    throw new Error('No super admin found — run seedSuperAdmin.js first.');
  }

  let fixed = 0;
  let removed = 0;
  let skipped = 0;

  for (const item of CORRECTIONS) {
    const doc = await Contribution.findById(item.id);
    if (!doc || doc.deleted) {
      console.log(`  SKIP  ${item.member} Week ${item.week} — document not found or already deleted (${item.id})`);
      skipped += 1;
      continue;
    }
    if (doc.amount !== item.dbAmount) {
      console.log(
        `  SKIP  ${item.member} Week ${item.week} — current amount (${doc.amount}) doesn't match expected DB value (${item.dbAmount}); may have already been fixed. Not touching. (${item.id})`
      );
      skipped += 1;
      continue;
    }

    if (item.expected === 0) {
      console.log(`  DELETE  ${item.member} Week ${item.week}  Ksh ${item.dbAmount} -> removed (ledger shows no contribution that week)`);
      if (CONFIRMED) {
        const before = snapshot(doc);
        doc.deleted = true;
        await doc.save();
        await logAudit({
          action: 'delete',
          entityType: 'Contribution',
          entityId: doc._id,
          performedBy: admin._id,
          before,
          after: snapshot(doc),
        }).catch((e) => console.warn(`    audit log failed: ${e.message}`));
      }
      removed += 1;
    } else {
      console.log(`  FIX     ${item.member} Week ${item.week}  Ksh ${item.dbAmount} -> Ksh ${item.expected}`);
      if (CONFIRMED) {
        const before = snapshot(doc);
        doc.amount = item.expected;
        await doc.save();
        await logAudit({
          action: 'update',
          entityType: 'Contribution',
          entityId: doc._id,
          performedBy: admin._id,
          before,
          after: snapshot(doc),
        }).catch((e) => console.warn(`    audit log failed: ${e.message}`));
      }
      fixed += 1;
    }
  }

  console.log(`\nSummary: ${fixed} to fix, ${removed} to remove, ${skipped} skipped.`);
  if (!CONFIRMED) {
    console.log('DRY RUN ONLY — nothing was written. Re-run with --confirm-cleanup to apply.');
  } else {
    console.log('Done — changes applied and logged to the audit trail.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});