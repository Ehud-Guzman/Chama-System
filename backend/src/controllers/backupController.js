const mongoose = require('mongoose');

function filenameDate(date) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

// Binary fields (document scans live in the database — see models/ChamaDocument)
// would otherwise serialise as { type: 'Buffer', data: [0..255] }: one JSON
// number per byte, which turns a 5 MB certificate into a 20 MB+ backup. Base64
// keeps the backup complete (restorable) at ~1.37x the raw size.
function encodeBuffers(value) {
  if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') };
  if (Array.isArray(value)) return value.map(encodeBuffers);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) out[key] = encodeBuffers(val);
    return out;
  }
  return value;
}

async function downloadBackup(req, res, next) {
  try {
    const exportedAt = new Date();
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const data = {};
    const counts = {};

    for (const collection of collections) {
      if (collection.name.startsWith('system.')) continue;
      const documents = await db.collection(collection.name).find({}).toArray();
      data[collection.name] = documents.map(encodeBuffers);
      counts[collection.name] = documents.length;
    }

    const backup = {
      format: 'chama-system-backup',
      version: 1,
      exportedAt: exportedAt.toISOString(),
      exportedBy: {
        id: String(req.user._id),
        name: req.user.name,
        role: req.user.role,
      },
      database: {
        name: db.databaseName,
        collections: Object.keys(data).sort(),
        counts,
      },
      data,
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chama-backup-${filenameDate(exportedAt)}.json"`
    );
    res.status(200).send(JSON.stringify(backup, null, 2));
  } catch (err) {
    next(err);
  }
}

module.exports = { downloadBackup };
