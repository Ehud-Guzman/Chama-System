// One-off inspection: dump every non-deleted contribution for a single
// member, sorted by date, so we can see what's actually contributing to an
// inflated total instead of guessing at a duplicate-matching rule.
//
// Usage:
//   node src/scripts/inspectMemberContributions.js "Benard Ngugi"

require('dotenv').config();

const mongoose = require('mongoose');
const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const Contribution = require('../models/Contribution');

const names = process.argv.slice(2);

async function main() {
  if (names.length === 0) {
    throw new Error('Usage: node src/scripts/inspectMemberContributions.js "Full Name" ["Another Name" ...]');
  }
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  for (const name of names) {
    const member = await Member.findOne({ name: new RegExp(`^${name}$`, 'i') }).lean();
    if (!member) {
      console.log(`No member found matching "${name}".`);
      continue;
    }

    const contributions = await Contribution.find({ memberId: member._id, deleted: false })
      .sort({ date: 1, createdAt: 1 })
      .lean();

    const typeIds = [...new Set(contributions.map((c) => String(c.typeId)))];
    const types = await ContributionType.find({ _id: { $in: typeIds } }).select('name').lean();
    const typeNameMap = new Map(types.map((t) => [String(t._id), t.name]));

    console.log(`\n=== ${member.name} — ${contributions.length} contribution(s), not deleted ===\n`);
    let total = 0;
    for (const c of contributions) {
      const dateStr = new Date(c.date).toISOString().slice(0, 10);
      const createdStr = new Date(c.createdAt).toISOString().slice(0, 10);
      const typeName = typeNameMap.get(String(c.typeId)) || c.typeId;
      console.log(
        `  ${dateStr}  Ksh ${String(c.amount).padStart(7)}  ${typeName.padEnd(22)}  note="${c.note || ''}"  (logged ${createdStr})`
      );
      total += c.amount;
    }
    console.log(`\nTOTAL (all types): Ksh ${total}`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});