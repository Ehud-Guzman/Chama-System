// Compares each member's current (post-cleanup) total in the database
// against the expected final total taken from the ledger workbook's own
// running-balance "total" column at their latest recorded week.
//
// This is read-only — it makes no changes, just prints a diff report so we
// can see exactly which members still have excess (or a shortfall) and by
// how much, to guide the next round of cleanup.
//
// Usage:
//   node src/scripts/diffMemberTotals.js

require('dotenv').config();

const mongoose = require('mongoose');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const { nonPersonalTypeIds } = require('../utils/personalTypes');

// Expected final total per member, taken from the ledger workbook's own
// "total" (running balance) column at each member's latest recorded week.
const LEDGER_EXPECTED = {
  "Evans Ndungu": 148500.0, "Patrick Njuguna": 106400.0, "Benard Ngugi": 119100.0,
  "Ndungu Mbugua": 106400.0, "Joseph Ndegwa": 107300.0, "Victor Kamau": 106700.0,
  "Peter Kimotho": 106400.0, "Samson Mwangi": 106500.0, "David Njoroge": 115700.0,
  "John Gatimu": 106400.0, "Joel Ndungu": 160500.0, "Benson Maina": 107900.0,
  "Benson Kaniu": 106810.0, "Eustace Mugwanja": 106550.0, "Joseph Gitonga": 103600.0,
  "Wilson Kabichu": 107800.0, "James Gachara": 53150.0, "Erick Mwangi": 94000.0,
  "Erick Njogu": 52500.0, "Dennis Wasike": 127150.0, "Samuel Gachara": 107000.0,
  "Zabron Macharia": 106400.0, "Paul Kimani": 106550.0, "Dickson Karethi": 106550.0,
  "Jackson Nakhulo": 67700.0, "Isaiah Maina": 155100.0, "Harrison Kamau": 197540.0,
  "Stanly Gachara": 43350.0, "George Ngechu": 107100.0, "Joshua Maina": 111000.0,
  "Isaac Njenga": 108350.0, "John Maina": 106850.0,
};

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const members = await Member.find({ name: { $in: Object.keys(LEDGER_EXPECTED) } }).lean();
  const excludedTypeIds = await nonPersonalTypeIds();
  const excludedSet = new Set(excludedTypeIds.map(String));

  const contributions = await Contribution.find({ deleted: false })
    .select('memberId typeId amount')
    .lean();

  const totalsByMember = new Map();
  for (const c of contributions) {
    if (excludedSet.has(String(c.typeId))) continue; // group-fund money, not personal
    const key = String(c.memberId);
    totalsByMember.set(key, (totalsByMember.get(key) || 0) + c.amount);
  }

  const rows = [];
  for (const m of members) {
    const dbTotal = totalsByMember.get(String(m._id)) || 0;
    const expected = LEDGER_EXPECTED[m.name];
    const diff = dbTotal - expected;
    rows.push({ name: m.name, dbTotal, expected, diff });
  }

  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log(
    `${'Member'.padEnd(20)} ${'DB Total'.padStart(12)} ${'Expected'.padStart(12)} ${'Diff'.padStart(12)}`
  );
  let totalExcess = 0;
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(20)} ${r.dbTotal.toFixed(0).padStart(12)} ${r.expected.toFixed(0).padStart(12)} ${r.diff
        .toFixed(0)
        .padStart(12)}`
    );
    totalExcess += r.diff;
  }
  console.log(`\nTotal excess across all listed members: Ksh ${totalExcess.toFixed(0)}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});