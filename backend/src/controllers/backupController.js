const { logAudit } = require('../utils/auditLogger');
const { logEvent } = require('../middleware/requestLogger');
const { encodeForBackup, filenameDate, writeBackupJson } = require('../utils/backup');
const AuditLog = require('../models/AuditLog');
const { listBackups, backupDir, retentionCount } = require('../jobs/backupJob');

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

// GET /api/backup/status — super_admin only, the same authority the download itself needs.
//
// The download button is the only thing standing between the group and having no copy of its own
// books that survives the host, and it depends entirely on somebody remembering to press it. Two
// facts make that memory workable, and neither was visible anywhere on the screen:
//
//   * when a copy was last taken OFF this machine — which the audit trail already knows, because
//     every download writes itself there;
//   * what is sitting ON the host instead. That is a different thing, and on an ephemeral disk it
//     is not a backup at all: it is the same fact the nightly job cannot fix from inside the app.
//     Reporting whether `BACKUP_DIR` is configured is what turns this panel into a straight answer
//     to "is the nightly file somewhere that survives a deploy?".
//
// Read-only, so it is safe to call whenever the screen loads.
async function backupStatus(req, res, next) {
  try {
    // A directory that cannot be read is not an error here: it means this host has never written
    // a backup, which is a thing the panel should say plainly rather than fail over.
    let files = [];
    try {
      files = listBackups(backupDir());
    } catch {
      files = [];
    }

    // Newest first, off the index the audit screen already pages through.
    const lastDownload = await AuditLog.findOne({ 'after.action': 'backup-download' })
      .sort({ createdAt: -1 })
      .populate('performedBy', 'name')
      .lean();

    const newest = files.length ? files[files.length - 1] : null;

    res.json({
      lastDownload: lastDownload
        ? {
            at: lastDownload.createdAt,
            by: lastDownload.performedBy?.name || null,
            // A slim backup is the data without the document bytes, so it cannot restore on its
            // own — the panel says so rather than letting it count as a copy.
            slim: Boolean(lastDownload.after?.slim),
          }
        : null,
      onHost: {
        directory: backupDir(),
        // Whether somebody has pointed the job at a mounted volume. False means the files live
        // on the app's own disk, where a redeploy removes them.
        persistent: Boolean(process.env.BACKUP_DIR),
        retention: retentionCount(),
        count: files.length,
        newest: newest ? { name: newest.name, at: new Date(newest.mtimeMs) } : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  downloadBackup,
  backupStatus,
  // Re-exported for the test suite and for anything that already imported it from here: the
  // encoding is the part of a backup that has to be exactly right, and it was silently wrong
  // once (dates became `{}`). The implementation lives in utils/backup.
  encodeForBackup,
};
