// Reports the members whose national ID would stop the unique index from building.
//
// The members' area is keyed on this column: a phone number / ID opens the gated
// documents, minutes and constitution. Two members holding the same number means
// the gate has to refuse both rather than show one member another's papers, so the
// model declares a partial unique index over non-empty values — and if duplicates
// already exist, that index silently fails to build (config/db.js now logs it).
//
//   node src/scripts/verifyNationalIds.js
//
// Read-only. Exit code 1 when duplicates exist, so it can gate a deploy.
require('dotenv').config();

const mongoose = require('mongoose');
const Member = require('../models/Member');
const { normalizeNationalId } = require('../utils/nationalId');

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  const members = await Member.find().select('name regNumber nationalId active').sort({ name: 1 }).lean();

  const buckets = new Map();
  for (const member of members) {
    // Compared the way the gate compares them, so "1234 5678" and "12345678" count
    // as the same number here exactly as they would at the door.
    const key = normalizeNationalId(member.nationalId);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(member);
  }

  const duplicates = [...buckets.entries()].filter(([, list]) => list.length > 1);
  const missing = members.filter((member) => !normalizeNationalId(member.nationalId));
  const nonNumeric = members.filter((member) => {
    const raw = String(member.nationalId || '').trim();
    return raw && !normalizeNationalId(raw);
  });

  console.log('== national IDs ==');
  console.log(`  members            ${members.length}`);
  console.log(`  distinct IDs       ${buckets.size}`);
  console.log(`  no usable ID       ${missing.length}`);
  console.log(`  free-text notes    ${nonNumeric.length}`);

  if (duplicates.length) {
    console.log(`\n== duplicates (${duplicates.length}) — the unique index cannot build ==`);
    for (const [key, list] of duplicates) {
      console.log(`  ${key}`);
      for (const member of list) {
        console.log(`    ${member.name} (${member.regNumber || 'no reg'}${member.active ? '' : ', inactive'})`);
      }
    }
    console.log(
      '\nFix these before the index can build: the gate refuses a number held by two members,\n' +
        'so both members are locked out of their own papers until one record is corrected.'
    );
  } else {
    console.log('\nNo duplicates — the unique index can build.');
  }

  if (nonNumeric.length) {
    console.log('\n== members whose ID column holds a note rather than a number ==');
    for (const member of nonNumeric) {
      console.log(`  ${member.name.padEnd(24)} "${String(member.nationalId).slice(0, 40)}"`);
    }
    console.log('  (These never enter the index — only "not yet issued" style notes.)');
  }

  await mongoose.disconnect();
  process.exit(duplicates.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nCheck failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
