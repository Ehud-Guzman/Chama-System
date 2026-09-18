/**
 * Restore a backup taken with GET /api/backup (Backup panel, super admin only).
 *
 * Until this existed the system could hand you a copy of the database and had no way
 * to read it back — which makes the backup a hope rather than a backup. This is the
 * other half: it reads the file, reports exactly what it would write, and only writes
 * when you say so.
 *
 *   node src/scripts/restoreBackup.js <file.json>                    dry run
 *   node src/scripts/restoreBackup.js <file.json> --confirm-write
 *   node src/scripts/restoreBackup.js backup.json --target=mongodb://127.0.0.1:27017/chama-rehearsal --confirm-write
 *   node src/scripts/restoreBackup.js backup.json --only=members,settings --confirm-write
 *   node src/scripts/restoreBackup.js backup.json --replace --confirm-write
 *
 * How it writes
 *
 *   Default is an **upsert by `_id`**: every document in the file is written under its
 *   own id, existing rows are replaced, and collections that are not in the file are
 *   left alone. That is the mode which cannot lose data that is not in the backup.
 *
 *   `--replace` empties each collection in the file first — a true restore to the
 *   moment the backup was taken, including rows deleted since. That is the mode you
 *   want after a disaster, and the one that can lose a day's entries if run by mistake.
 *
 * Restoring onto the *same* database the backup came from (a real recovery) also needs
 * `--replace-live`: two deliberate keys, because that is the operation which
 * overwrites the group's live books.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Every model, so the restore writes *through* them: Mongoose then casts the strings a
// JSON file carries back into ObjectIds, Dates and Buffers. Writing with the raw
// driver instead is how a "restored" database ends up full of dates that are strings —
// and every week number computed from them wrong.
require('../models/Member');
require('../models/Contribution');
require('../models/ContributionType');
require('../models/Expense');
require('../models/Fine');
require('../models/FineType');
require('../models/Minute');
require('../models/Settings');
require('../models/User');
require('../models/AuditLog');
require('../models/ChamaDocument');
require('../models/DocumentCategory');
require('../models/ConstitutionDecision');
require('../models/ConstitutionText');
// The reg-number sequence: without it a restored database hands out numbers it has
// already used.
require('../models/Counter');

const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--'));
const CONFIRMED = argv.includes('--confirm-write');
const REPLACE = argv.includes('--replace');
const REPLACE_LIVE = argv.includes('--replace-live');
const TARGET = (argv.find((a) => a.startsWith('--target=')) || '').slice('--target='.length);
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '')
  .slice('--only='.length)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

// {$binary: "base64"} -> Buffer, {$date: "ISO"} -> Date, recursively. Everything else is
// left as the string the file carries, for Mongoose to cast.
//
// Version 1 of the format had neither marker: dates were written as `{}` (see
// encodeForBackup in backupController) and are unrecoverable from such a file. Version 2
// writes them, and a v2 file restores faithfully.
function reviveBuffers(value) {
  if (Array.isArray(value)) return value.map(reviveBuffers);
  if (value && typeof value === 'object') {
    if (typeof value.$binary === 'string') return Buffer.from(value.$binary, 'base64');
    if (typeof value.$date === 'string') return new Date(value.$date);
    const out = {};
    for (const [key, val] of Object.entries(value)) out[key] = reviveBuffers(val);
    return out;
  }
  return value;
}

// Collection name -> the model that owns it, so writes go through casting.
function modelByCollection() {
  const map = new Map();
  for (const model of Object.values(mongoose.models)) {
    if (model.collection?.name) map.set(model.collection.name, model);
  }
  return map;
}

async function main() {
  if (!FILE) {
    fail('Name the backup file: node src/scripts/restoreBackup.js <file.json> [--confirm-write]');
  }
  const filePath = path.resolve(FILE);
  if (!fs.existsSync(filePath)) fail(`No file at ${filePath}`);

  let backup;
  try {
    backup = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`That file is not readable as JSON: ${err.message}`);
  }
  if (backup.format !== 'chama-system-backup') {
    fail(`That file is not a chama backup (format: ${backup.format || 'missing'}).`);
  }

  const uri = TARGET || process.env.MONGO_URI;
  if (!uri) fail('MONGO_URI is not set and no --target was given.');

  const data = backup.data || {};
  const names = Object.keys(data)
    .filter((name) => (ONLY.length ? ONLY.includes(name) : true))
    .sort();

  console.log('== the file ==');
  console.log(`  path          ${filePath}`);
  console.log(`  taken         ${backup.exportedAt || '(unknown)'}`);
  console.log(`  by            ${backup.exportedBy?.name || '(unknown)'}`);
  console.log(`  from database ${backup.database?.name || '(unknown)'}`);
  console.log(
    `  slim          ${backup.slim === true ? 'yes — document bytes are NOT in this file' : 'no'}`
  );
  console.log(`  collections   ${names.length}${ONLY.length ? ' (filtered by --only)' : ''}`);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, bufferCommands: false });
  const db = mongoose.connection.db;
  const targetName = db.databaseName;

  console.log('\n== the target ==');
  console.log(`  database      ${targetName}`);
  console.log(
    `  mode          ${REPLACE ? 'REPLACE (each collection emptied first)' : 'upsert by _id'}`
  );

  if (targetName === backup.database?.name && !REPLACE_LIVE) {
    console.error(
      '\n  That is the database the backup was taken from, so this is a real recovery\n' +
        '  rather than a rehearsal. Nothing has been written.\n\n' +
        '  Rehearse it on a scratch database first:\n' +
        `    node src/scripts/restoreBackup.js "${filePath}" --target=mongodb://127.0.0.1:27017/chama-rehearsal --confirm-write\n\n` +
        '  If you do mean to recover onto the live database, add --replace-live as well.\n'
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const models = modelByCollection();
  const plan = [];
  for (const name of names) {
    const docs = data[name] || [];
    const existing = await db.collection(name).countDocuments();
    plan.push({ name, docs: docs.length, existing, model: models.get(name) });
  }

  console.log('\n== what would be written ==');
  for (const row of plan) {
    const via = row.model ? row.model.modelName : 'raw driver (no model)';
    console.log(
      `  ${row.name.padEnd(22)} file ${String(row.docs).padStart(5)}   in database ${String(
        row.existing
      ).padStart(5)}   via ${via}`
    );
  }
  const totalDocs = plan.reduce((sum, row) => sum + row.docs, 0);
  console.log(`  ${'total'.padEnd(22)} ${String(totalDocs).padStart(10)} documents`);

  if (!CONFIRMED) {
    console.log('\nDRY RUN — nothing written. Re-run with --confirm-write to restore.');
    await mongoose.disconnect();
    return;
  }

  await writeEverything({ db, plan, data, names, filePath, targetName, backup });
  await mongoose.disconnect();
}
async function writeEverything({ db, plan, data, names, filePath, targetName, backup }) {
  console.log('\n== writing ==');
  let inserted = 0;
  let replaced = 0;
  let failed = 0;

  for (const row of plan) {
    const docs = (data[row.name] || []).map(reviveBuffers);

    if (!docs.length) {
      if (REPLACE) {
        const res = await db.collection(row.name).deleteMany({});
        console.log(`  ${row.name.padEnd(22)} emptied (${res.deletedCount})`);
      } else {
        console.log(`  ${row.name.padEnd(22)} nothing in the file`);
      }
      continue;
    }

    if (REPLACE) await db.collection(row.name).deleteMany({});

    if (row.model) {
      // Casting, but no validation.
      //
      // `new Model(doc)` runs the schema's casting and setters, which is what turns the
      // file's strings back into ObjectIds and Dates. It does *not* run validators —
      // and that is deliberate: a restore reproduces the database, it does not re-audit
      // it. A member whose record predates a field the schema now insists on is still a
      // member, and a restore that refused him would produce a database that looks
      // restored and is quietly missing people.
      //
      // The write then goes through the collection rather than the model, so nothing
      // else can filter a document out. Fields the schema does not know about are kept
      // as the file has them.
      const writes = [];
      const unusable = [];
      for (const doc of docs) {
        try {
          const casted = new row.model(doc).toObject({
            depopulate: true,
            virtuals: false,
            getters: false,
          });
          const merged = { ...doc, ...casted };
          writes.push({
            replaceOne: { filter: { _id: merged._id }, replacement: merged, upsert: true },
          });
        } catch (err) {
          unusable.push(`${doc._id}: ${err.message}`);
        }
      }

      try {
        const res = writes.length
          ? await row.model.collection.bulkWrite(writes, { ordered: false })
          : { upsertedCount: 0, modifiedCount: 0, matchedCount: 0 };
        inserted += res.upsertedCount || 0;
        replaced += res.modifiedCount || 0;
        console.log(
          `  ${row.name.padEnd(22)} ${res.upsertedCount || 0} new, ${res.modifiedCount || 0} replaced, ${
            res.matchedCount || 0
          } matched`
        );
      } catch (err) {
        failed += 1;
        console.error(`  ${row.name.padEnd(22)} FAILED: ${err.message}`);
      }

      // A document that could not even be cast is data the database will not have, and
      // saying so is the whole point of this report.
      if (unusable.length) {
        failed += 1;
        console.error(`  ${row.name.padEnd(22)} ${unusable.length} document(s) could not be read:`);
        for (const problem of unusable.slice(0, 5)) console.error(`      ${problem}`);
        if (unusable.length > 5) console.error(`      …and ${unusable.length - 5} more`);
      }
    } else {
      const res = await db
        .collection(row.name)
        .insertMany(docs, { ordered: false })
        .catch((err) => {
          failed += 1;
          console.error(`  ${row.name.padEnd(22)} FAILED: ${err.message}`);
          return { insertedCount: 0 };
        });
      inserted += res.insertedCount || 0;
      console.log(`  ${row.name.padEnd(22)} ${res.insertedCount || 0} inserted (raw driver)`);
    }
  }

  // Restoring writes the whole register, so it leaves the trace a reset does: what file,
  // onto which database, and in which mode. Written even when the file carried the audit
  // trail itself — that trail ends at the moment the backup was taken, so without this
  // entry the restored database has no record of having been restored.
  const AuditLog = mongoose.models.AuditLog;
  if (AuditLog) {
    await AuditLog.create({
      action: 'reset',
      entityType: 'System',
      entityId: new mongoose.Types.ObjectId(),
      performedBy: backup.exportedBy?.id || new mongoose.Types.ObjectId(),
      after: {
        action: 'restore-backup',
        file: path.basename(filePath),
        target: targetName,
        mode: REPLACE ? 'replace' : 'upsert',
        collections: names.length,
      },
    });
  }

  console.log(`\n== done ==\n  ${inserted} inserted, ${replaced} replaced, ${failed} collection(s) failed`);
  if (failed) {
    console.log(
      '  Read the failures above before trusting this database — a partial restore is not a restore.'
    );
  }
  console.log(`  Check one member against the paper book before using ${targetName}.`);
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('\nRestore failed:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { reviveBuffers };

