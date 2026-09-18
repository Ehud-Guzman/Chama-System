const mongoose = require('mongoose');
const { logAudit } = require('../utils/auditLogger');
const { logEvent } = require('../middleware/requestLogger');

function filenameDate(date) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

// Making a document safe to put in a JSON file, and readable when it comes back.
//
// Two types need help and everything else does not:
//
//   Buffer  — JSON has no bytes. `{type:'Buffer', data:[…]}` is one number per byte,
//             which turns a 5 MB certificate into a 20 MB+ backup, so it is base64
//             (`$binary`). `slim` drops the bytes entirely: that copy is for reading or
//             emailing, not for restoring.
//   Date    — this is the one that was wrong. A Date has no own enumerable properties,
//             so a function that walks a document with `Object.entries` turns every
//             date into `{}` — and a backup full of empty dates restores a database
//             whose week anchor, contribution dates and audit trail are all corrupt.
//             It is written as `{$date: ISO}`.
//
// Everything else (ObjectId, Decimal128, Long) has its own `toJSON` and is left to it:
// an id serialises as its hex string, and the restore casts it back through the model.
// That is why this function returns the value rather than walking it.
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

// GET /api/backup — super_admin only.
//
// Streamed a collection at a time rather than assembled into one string: the whole
// database with its document scans is far too much to hold in memory twice (as
// objects, then as JSON) on a small instance, and a download that dies half way
// leaves nothing behind.
//
// The file is the database as it stands, which includes the accounts and their
// password hashes — that is what makes it restorable — so the download is recorded
// in the audit trail and `?slim=1` is available when what is wanted is the data
// rather than a restore.
async function downloadBackup(req, res, next) {
  try {
    const slim = req.query.slim === '1' || req.query.slim === 'true';
    const exportedAt = new Date();
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const primaries = collections
      .filter((collection) => !collection.name.startsWith('system.'))
      .map((collection) => collection.name);

    const counts = {};
    for (const name of primaries) {
      counts[name] = await db.collection(name).countDocuments();
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chama-backup-${filenameDate(exportedAt)}${slim ? '-slim' : ''}.json"`
    );
    res.setHeader('Cache-Control', 'no-store');

    // The envelope first, then one collection at a time.
    res.write('{\n');
    res.write('  "format": "chama-system-backup",\n');
    res.write('  "version": 2,\n');
    res.write(`  "exportedAt": "${exportedAt.toISOString()}",\n`);
    res.write(`  "slim": ${slim},\n`);
    res.write(
      `  "exportedBy": ${JSON.stringify({
        id: String(req.user._id),
        name: req.user.name,
        role: req.user.role,
      })},\n`
    );
    res.write(
      `  "database": ${JSON.stringify(
        { name: db.databaseName, collections: primaries.slice().sort(), counts },
        null,
        2
      ).replace(/\n/g, '\n  ')},\n`
    );
    res.write('  "data": {\n');

    for (let index = 0; index < primaries.length; index += 1) {
      const name = primaries[index];
      const documents = await db.collection(name).find({}).toArray();
      const body = JSON.stringify(documents.map((doc) => encodeForBackup(doc, slim)));
      res.write(`    ${JSON.stringify(name)}: ${body}${index === primaries.length - 1 ? '' : ','}\n`);
    }

    res.write('  }\n}\n');
    res.end();

    await logAudit({
      action: 'create',
      entityType: 'System',
      entityId: req.user._id,
      performedBy: req.user._id,
      after: { action: 'backup-download', slim, collections: primaries.length, counts },
    });
  } catch (err) {
    // Headers may already be sent; `next` would try to write a JSON error on top of
    // a half-written body, so the log and the socket are all that is left.
    if (res.headersSent) {
      logEvent('backup_failed', { rid: req.id, error: err.message }, 'error');
      return res.destroy();
    }
    return next(err);
  }
}

module.exports = {
  downloadBackup,
  // Exported for the test suite: the encoding is the part of a backup that has to be
  // exactly right, and it was silently wrong once (dates became `{}`).
  encodeForBackup,
};
