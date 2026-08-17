// One-off correction: 5 members' week 60 opening-balance ("Previous") figure
// was transcribed wrong during the original import — update each existing
// Contribution to the correct amount rather than add a duplicate.
require('dotenv').config();
const mongoose = require('mongoose');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const { logAudit, snapshot } = require('../utils/auditLogger');

const NOTE = 'Week 60 cumulative balance imported from paper ledger';

const CORRECTIONS = {
  'John Gatimu': 64300,
  'Benson Kaniu': 78360,
  'Erick Mwangi': 60750,
  'Samuel Gachara': 55800,
  'Joshua Maina': 72800,
};

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set.');
  await mongoose.connect(process.env.MONGO_URI);

  const weeklyType = await ContributionType.findOne({ name: 'Weekly Contribution' });
  if (!weeklyType) throw new Error('Weekly Contribution type not found.');

  for (const [name, correctAmount] of Object.entries(CORRECTIONS)) {
    const member = await Member.findOne({ name });
    if (!member) { console.warn(`⚠ Member not found: ${name}`); continue; }
    const contribution = await Contribution.findOne({ memberId: member._id, typeId: weeklyType._id, note: NOTE });
    if (!contribution) { console.warn(`⚠ No opening-balance contribution found for ${name}`); continue; }

    if (contribution.amount === correctAmount) {
      console.log(`${name}: already ${correctAmount}, no change.`);
      continue;
    }
    const before = snapshot(contribution);
    const oldAmount = contribution.amount;
    contribution.amount = correctAmount;
    await contribution.save();
    await logAudit({ action: 'update', entityType: 'Contribution', entityId: contribution._id, performedBy: member.createdBy, before, after: snapshot(contribution) });
    console.log(`${name}: corrected ${oldAmount} -> ${correctAmount}`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
