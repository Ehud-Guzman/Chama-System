const mongoose = require('mongoose');

// The backup file's format, in one place.
//
// It used to live inside the download endpoint, which was fine while the endpoint was the
// only thing that made a backup. It is not: the nightly job writes the same file to disk,
// and a format with two implementations is a format with one implementation and one bug.
// The rule that matters — a backup is only ever read when something has already gone wrong,
// so it has to be readable by the code that reads it back — is why the two paths share
// this module rather than each writing their own envelope.
//
// The file is written through a `write` callback so the same code serves an HTTP response
// and a file stream, and it is written a collection at a time because the whole database
// with its document scans will not fit in memory twice on a small instance.

// Version 2: dates are `{$date: ISO}` and document bytes are `{$binary: base64}`.
// Any backup written before 2026-09-18 is version 1 and cannot be trusted — a bug turned
// every date in it into `{}`.
const BACKUP_FORMAT = 'chama-system-backup';
const BACKUP_VERSION = 2;

function filenameDate(date) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

// Making a document safe to put in a JSON file, and readable when it comes back.
//
// Two types need help and everything else does not:
//
//   Buffer  — JSON has no bytes. `{type:'Buffer', data:[…]}` is one number per byte, which
//             turns a 5 MB certificate into a 20 MB+ backup, so it is base64 (`$binary`).
//             `slim` drops the bytes entirely: that copy is for reading or emailing, not
//             for restoring.
//   Date    — this is the one that was wrong. A Date has no own enumerable properties, so a
//             function that walks a document with `Object.entries` turns every date into
//             `{}` — and a backup full of empty dates restores a database whose week anchor,
//             contribution dates and audit trail are all corrupt. It is written as
//             `{$date: ISO}`.
//
// Everything else (ObjectId, Decimal128, Long) has its own `toJSON` and is left to it: an id
// serialises as its hex string, and the restore casts it back through the model. That is
// why this function returns the value rather than walking it.
function encodeForBackup(value, slim) {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Buffer.isBuffer(value)) return slim ? null : { $binary: value.toString('base64') };
  if (Array.isArray(value)) return value.map((item) => encodeForBackup(item, slim));
  if (value && typeof value === 'object') {
    // A BSON type that knows how to serialise itself: leave it alone.
    if (typeof value.toJSON === 'function') return value;
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (slim && key === 'data') {
        out.data = null; // document bytes
        continue;
      }
      out[key] = encodeForBackup(val, slim);
    }
    return out;
  }
  return value;
}

// Writes the whole database through `write`, and returns what it wrote so the caller can
// put it in an audit entry or a job summary.
//
// `write` is awaited, which is what lets the nightly job hand back a promise that settles on
// the stream's `drain` event: without that, the whole file queues up in the process's memory
// whenever the disk is slower than the database. The HTTP caller returns nothing and awaits
// nothing, so the same code serves both.
//
// One collection is read at a time and released before the next, so peak memory is the largest
// collection plus its JSON — not the database plus its JSON.
async function writeBackupJson(write, { slim = false, exportedBy = null } = {}) {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Not connected to a database');

  const exportedAt = new Date();
  const collections = await db.listCollections().toArray();
  const primaries = collections
    .filter((collection) => !collection.name.startsWith('system.'))
    .map((collection) => collection.name);

  const counts = {};
  for (const name of primaries) {
    counts[name] = await db.collection(name).countDocuments();
  }

  // The envelope first, then one collection at a time.
  await write('{\n');
  await write(`  "format": ${JSON.stringify(BACKUP_FORMAT)},\n`);
  await write(`  "version": ${BACKUP_VERSION},\n`);
  await write(`  "exportedAt": "${exportedAt.toISOString()}",\n`);
  await write(`  "slim": ${slim},\n`);
  await write(`  "exportedBy": ${JSON.stringify(exportedBy)},\n`);
  await write(
    `  "database": ${JSON.stringify(
      { name: db.databaseName, collections: primaries.slice().sort(), counts },
      null,
      2
    ).replace(/\n/g, '\n  ')},\n`
  );
  await write('  "data": {\n');

  for (let index = 0; index < primaries.length; index += 1) {
    const name = primaries[index];
    const documents = await db.collection(name).find({}).toArray();
    const body = JSON.stringify(documents.map((doc) => encodeForBackup(doc, slim)));
    await write(`    ${JSON.stringify(name)}: ${body}${index === primaries.length - 1 ? '' : ','}\n`);
  }

  await write('  }\n}\n');
  return { exportedAt, collections: primaries, counts, slim };
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  filenameDate,
  encodeForBackup,
  writeBackupJson,
};
