// Copies the constitution's text into the database.
//
// Why this exists: the members-only constitution used to live only in
// src/data/constitution.js — a file in the repository, which is a strange place for
// the one document the API gates behind a member's ID. The API reads the database
// row first (utils/constitutionData), so seeding it is what lets the file be
// deleted.
//
//   node src/scripts/seedConstitution.js --confirm-write
//   node src/scripts/seedConstitution.js --confirm-write --from=/secure/constitution.js
//
// After it has run and the constitution page has been checked, the source file can
// go:
//
//   git rm backend/src/data/constitution.js
//
// With `--from`, the text can come from anywhere on disk — the copy kept outside
// the repository — which is how the file leaves git without the text being lost.
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const ConstitutionText = require('../models/ConstitutionText');
const { invalidateConstitution } = require('../utils/constitutionData');
const { resolveScriptActor, operatorEmailFromArgv, logScriptRun } = require('../utils/scriptAudit');

const CONFIRMED = process.argv.includes('--confirm-write');
const FROM = (process.argv.find((a) => a.startsWith('--from=')) || '').slice('--from='.length);

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
  }

  const source = FROM || path.join(__dirname, '..', 'data', 'constitution.js');
  if (!fs.existsSync(source)) {
    console.error(`No constitution file at ${source}.`);
    console.error('Pass --from=/path/to/constitution.js (the copy kept outside the repository).');
    process.exit(1);
  }

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const data = require(path.resolve(source));
  const meta = data.constitutionMeta;
  const chapters = data.constitutionChapters;

  if (!meta || !Array.isArray(chapters) || chapters.length === 0) {
    console.error(`${source} does not export constitutionMeta + constitutionChapters.`);
    process.exit(1);
  }

  console.log('== constitution to seed ==');
  console.log(`  source      ${source}`);
  console.log(`  edition     ${meta.eyebrow || '(none)'} — ${meta.title || '(no title)'}`);
  console.log(`  chapters    ${chapters.length}`);
  console.log(`  clauses     ${chapters.reduce((sum, c) => sum + (c.clauses?.length || 0), 0)}`);
  console.log(`  payload     ${(JSON.stringify({ meta, chapters }).length / 1024).toFixed(0)} KB`);

  if (!CONFIRMED) {
    console.log('\nNothing written. Re-run with --confirm-write to save it.');
    process.exit(0);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('\nMongoDB connected');

  const existing = await ConstitutionText.findOne({ key: 'main' }).lean();
  const actor = await resolveScriptActor(operatorEmailFromArgv());
  const saved = await ConstitutionText.findOneAndUpdate(
    { key: 'main' },
    {
      $set: { meta, chapters, edition: meta.eyebrow || '', seededAt: new Date() },
      $setOnInsert: { key: 'main' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  invalidateConstitution();

  await logScriptRun({
    actor,
    action: existing ? 'update' : 'create',
    entityId: saved._id,
    before: existing ? { chapters: existing.chapters?.length || 0 } : null,
    summary: { action: 'seed-constitution', chapters: chapters.length, source },
  });

  console.log(`\n== written ==`);
  console.log(`  row         ${saved._id} (key: main)`);
  console.log(`  chapters    ${saved.chapters.length}`);
  console.log('\nThe members\' page now serves the database copy. Check it, then:');
  console.log('  git rm backend/src/data/constitution.js && git commit -m "Take the constitution out of the repository"');
  console.log('\n(The README section "Member data in this repository" covers the same step.)');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nSeed failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
