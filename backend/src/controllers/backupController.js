const mongoose = require('mongoose');

function filenameDate(date) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
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
      data[collection.name] = documents;
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
