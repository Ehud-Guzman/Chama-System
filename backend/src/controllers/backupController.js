const mongoose = require('mongoose');
const { logAudit } = require('../utils/auditLogger');
const { logEvent } = require('../middleware/requestLogger');

function filenameDate(date) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

// Binary fields (document scans live in the database — see models/ChamaDocument)
// would otherwise serialise as { type: 'Buffer', data: [0..255] }: one JSON
// number per byte, which turns a 5 MB certificate into a 20 MB+ backup. Base64
// keeps the backup complete (restorable) at ~1.37x the raw size.
//
// `slim` leaves those bytes out entirely: a copy that is meant to be read (or
// emailed to the committee) rather than restored, at a fraction of the size.
function encodeBuffers(value, slim) {
  if (Buffer.isBuffer(value)) return slim ? null : { $binary: value.toString('base64') };
  if (Array.isArray(value)) return value.map((item) => encodeBuffers(item, slim));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (slim && key === 'data') {
        out.data = null; // document bytes
        continue;
      }
      out[key] = encodeBuffers(val, slim);
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
    res.write('  "version": 1,\n');
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
      const body = JSON.stringify(documents.map((doc) => encodeBuffers(doc, slim)));
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

module.exports = { downloadBackup };
