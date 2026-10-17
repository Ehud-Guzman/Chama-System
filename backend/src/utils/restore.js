const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { BACKUP_FORMAT } = require('./backup');

// Reading a backup back in.
//
// This is the logic that used to live inside scripts/restoreBackup.js, lifted out so the Control
// Room's restore and the command-line one are the same code. A restore is the operation that is
// only ever run when something has already gone wrong, so two implementations of it would be two
// chances to be wrong at the worst possible moment.
//
// Nothing here prints or exits: it returns what it found and what it did, and the caller decides
// how to say so.

// Every model, so a restore writes *through* them: Mongoose casts the strings a JSON file carries
// back into ObjectIds, Dates and Buffers. Writing with the raw driver instead is how a "restored"
// database ends up full of dates that are strings. Loaded from the directory rather than a list,
// so a model added next year is restorable without anybody remembering to add it here.
function loadAllModels() {
  const dir = path.join(__dirname, '..', 'models');
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.js')) require(path.join(dir, file));
  }
}

// {$binary: "base64"} -> Buffer, {$date: "ISO"} -> Date, recursively. Everything else is left as
// the string the file carries, for Mongoose to cast.
//
// Version 1 of the format had neither marker: dates were written as `{}` and are unrecoverable
// from such a file. Version 2 writes them, and a v2 file restores faithfully.
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

// Parses and checks a backup file. Throws an Error written for a person to read.
function parseBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch (err) {
    throw new Error(`That file is not readable as JSON: ${err.message}`);
  }
  if (!backup || backup.format !== BACKUP_FORMAT) {
    throw new Error(`That file is not a chama backup (format: ${backup?.format || 'missing'}).`);
  }
  if (!backup.data || typeof backup.data !== 'object') {
    throw new Error('That backup holds no data.');
  }
  return backup;
}

// A backup file as text, whether it is the plain .json the Backup button downloads or the .json.gz the
// off-server copy is stored as (utils/offsiteBackup). Told by what is inside, not by the name: a
// gzip file begins with the bytes 1f 8b, and a file renamed by a download manager is still one.
function backupText(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      return require('zlib').gunzipSync(bytes).toString('utf8');
    } catch (err) {
      throw new Error(`That file looks compressed but could not be unpacked: ${err.message}`);
    }
  }
  return bytes.toString('utf8');
}

function readBackupFile(filePath) {
  return parseBackup(backupText(fs.readFileSync(filePath)));
}

// What a restore would do, without doing it: for each collection in the file, how many documents
// it carries, how many the database already holds, and how many of the file's would land on an
// existing id (and so be replaced rather than added).
async function planRestore({ backup, db, only = [] }) {
  loadAllModels();
  const models = modelByCollection();
  const data = backup.data || {};
  const names = Object.keys(data)
    .filter((name) => (only.length ? only.includes(name) : true))
    .sort();

  const plan = [];
  for (const name of names) {
    const docs = data[name] || [];
    const existing = await db.collection(name).countDocuments();
    let overlapping = 0;
    if (docs.length && existing) {
      // Ids are compared as strings, which is how the file carries them.
      const ids = [];
      for (const doc of docs) {
        const id = reviveBuffers(doc)._id;
        if (id !== undefined && id !== null && mongoose.Types.ObjectId.isValid(String(id))) {
          ids.push(new mongoose.Types.ObjectId(String(id)));
        }
      }
      overlapping = await db.collection(name).countDocuments({ _id: { $in: ids } });
    }
    plan.push({
      name,
      docs: docs.length,
      existing,
      overlapping,
      added: Math.max(0, docs.length - overlapping),
      model: models.get(name) || null,
    });
  }
  return plan;
}

// Writes the plan. Default is an upsert by `_id`: every document in the file is written under its
// own id, existing rows are replaced, and collections or rows that are not in the file are left
// alone — the mode that cannot lose data that is not in the backup. `replace` empties each
// collection in the file first (a true restore to the moment the backup was taken, including rows
// deleted since), which the command line offers and the Control Room does not.
async function applyRestore({ backup, plan, db, replace = false, log = () => {} }) {
  const data = backup.data || {};
  let inserted = 0;
  let replaced = 0;
  let failed = 0;
  const perCollection = [];

  for (const row of plan) {
    const docs = (data[row.name] || []).map(reviveBuffers);

    if (!docs.length) {
      if (replace) {
        const res = await db.collection(row.name).deleteMany({});
        log(`  ${row.name.padEnd(22)} emptied (${res.deletedCount})`);
      } else {
        log(`  ${row.name.padEnd(22)} nothing in the file`);
      }
      perCollection.push({ name: row.name, inserted: 0, replaced: 0, failed: false });
      continue;
    }

    if (replace) await db.collection(row.name).deleteMany({});

    let collectionInserted = 0;
    let collectionReplaced = 0;
    let collectionFailed = false;

    if (row.model) {
      // Casting, but no validation.
      //
      // `new Model(doc)` runs the schema's casting and setters, which is what turns the file's
      // strings back into ObjectIds and Dates. It does *not* run validators — deliberately: a
      // restore reproduces the database, it does not re-audit it. A member whose record predates
      // a field the schema now insists on is still a member, and a restore that refused him would
      // produce a database that looks restored and is quietly missing people.
      //
      // The write then goes through the collection rather than the model, so nothing else can
      // filter a document out. Fields the schema does not know about are kept as the file has them.
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
        collectionInserted = res.upsertedCount || 0;
        collectionReplaced = res.modifiedCount || 0;
        log(
          `  ${row.name.padEnd(22)} ${collectionInserted} new, ${collectionReplaced} replaced, ${
            res.matchedCount || 0
          } matched`
        );
      } catch (err) {
        collectionFailed = true;
        log(`  ${row.name.padEnd(22)} FAILED: ${err.message}`, 'error');
      }

      // A document that could not even be cast is data the database will not have, and saying so
      // is the whole point of this report.
      if (unusable.length) {
        collectionFailed = true;
        log(`  ${row.name.padEnd(22)} ${unusable.length} document(s) could not be read:`, 'error');
        for (const problem of unusable.slice(0, 5)) log(`      ${problem}`, 'error');
        if (unusable.length > 5) log(`      …and ${unusable.length - 5} more`, 'error');
      }
    } else {
      try {
        const res = await db.collection(row.name).insertMany(docs, { ordered: false });
        collectionInserted = res.insertedCount || 0;
        log(`  ${row.name.padEnd(22)} ${collectionInserted} inserted (raw driver)`);
      } catch (err) {
        collectionFailed = true;
        log(`  ${row.name.padEnd(22)} FAILED: ${err.message}`, 'error');
      }
    }

    inserted += collectionInserted;
    replaced += collectionReplaced;
    if (collectionFailed) failed += 1;
    perCollection.push({
      name: row.name,
      inserted: collectionInserted,
      replaced: collectionReplaced,
      failed: collectionFailed,
    });
  }

  return { inserted, replaced, failed, perCollection };
}

module.exports = {
  loadAllModels,
  reviveBuffers,
  modelByCollection,
  parseBackup,
  backupText,
  readBackupFile,
  planRestore,
  applyRestore,
};
