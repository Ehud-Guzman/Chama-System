const { logAudit } = require('../utils/auditLogger');
const { logEvent } = require('../middleware/requestLogger');
const { encodeForBackup, filenameDate, writeBackupJson } = require('../utils/backup');

// GET /api/backup — super_admin only.
//
// Streamed a collection at a time rather than assembled into one string: the whole database
// with its document scans is far too much to hold in memory twice (as objects, then as JSON)
// on a small instance, and a download that dies half way leaves nothing behind. The writing
// itself lives in utils/backup, because the nightly job writes the same file to disk and two
// implementations of one format is two chances to write an unreadable one.
//
// The file is the database as it stands, which includes the accounts and their password
// hashes — that is what makes it restorable — so the download is recorded in the audit trail
// and `?slim=1` is available when what is wanted is the data rather than a restore.
async function downloadBackup(req, res, next) {
  try {
    const slim = req.query.slim === '1' || req.query.slim === 'true';

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chama-backup-${filenameDate(new Date())}${slim ? '-slim' : ''}.json"`
    );
    res.setHeader('Cache-Control', 'no-store');

    const result = await writeBackupJson((chunk) => res.write(chunk), {
      slim,
      exportedBy: { id: String(req.user._id), name: req.user.name, role: req.user.role },
    });
    res.end();

    await logAudit({
      action: 'create',
      entityType: 'System',
      entityId: req.user._id,
      performedBy: req.user._id,
      after: {
        action: 'backup-download',
        slim,
        collections: result.collections.length,
        counts: result.counts,
      },
    });
  } catch (err) {
    // Headers may already be sent; `next` would try to write a JSON error on top of a
    // half-written body, so the log and the socket are all that is left.
    if (res.headersSent) {
      logEvent('backup_failed', { rid: req.id, error: err.message }, 'error');
      return res.destroy();
    }
    return next(err);
  }
}

module.exports = {
  downloadBackup,
  // Re-exported for the test suite and for anything that already imported it from here: the
  // encoding is the part of a backup that has to be exactly right, and it was silently wrong
  // once (dates became `{}`). The implementation lives in utils/backup.
  encodeForBackup,
};
