// Creates the "Opening Balances" system member if it's missing. Does NOT
// touch anything else — no wipe, no other writes. Safe to re-run: if the
// member already exists, it reports that and exits without creating a
// duplicate.
//
// Usage:
//   node src/scripts/seedOpeningBalancesMember.js

require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');
const Member = require('../models/Member');
const { logAudit, snapshot } = require('../utils/auditLogger');

// Matches importWeek60Ledger.js exactly, so this member looks the same as
// if that original script had completed successfully.
const SHEET_DATE = new Date('2026-02-05T12:00:00Z');
const WEEK_NUMBER = 60;

function joinDateFromWeek(sheetDate, weekNumber) {
  const weeksBack = weekNumber - 1;
  const d = new Date(sheetDate);
  d.setDate(d.getDate() - weeksBack * 7);
  return d;
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const existing = await Member.findOne({ name: 'Opening Balances' });
  if (existing) {
    console.log(`"Opening Balances" already exists (_id: ${existing._id}). Nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  const admin = await User.findOne({ role: 'super_admin' });
  if (!admin) {
    throw new Error('No super admin found — run seedSuperAdmin.js first.');
  }

  const joinDate = joinDateFromWeek(SHEET_DATE, WEEK_NUMBER);

  const systemMember = await Member.create({
    name: 'Opening Balances',
    phone: 'N/A',
    regNumber: 'SYSTEM-001',
    notes: 'System member for group funds (fines, tea, registration, resignation). Not a real member.',
    joinDate,
    createdBy: admin._id,
    active: false,
  });

  await logAudit({
    action: 'create',
    entityType: 'Member',
    entityId: systemMember._id,
    performedBy: admin._id,
    after: snapshot(systemMember),
  });

  console.log(`Created "Opening Balances" (_id: ${systemMember._id}).`);
  console.log('You can now re-run importLedgerIncremental.js --confirm-import.');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});