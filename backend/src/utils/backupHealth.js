const AuditLog = require('../models/AuditLog');
const { listBackups, backupDir, retentionCount } = require('../jobs/backupJob');

// How old is the copy in somebody's hands?
//
// The nightly job writes a file onto the host, and on a host with an ephemeral disk a redeploy
// takes it with it. So the copy that answers "the database is gone" is the one somebody
// downloaded, which makes the age of the last download the group's real backup status.
//
// An age is exactly the kind of fact that stays invisible until somebody thinks to look, and the
// failure mode is not an error message — it is a silence that lasts for months. So it is computed
// once here and said in several places: the Backup panel, the weekly reconciliation, the weekly
// reminder sweep's own record, and `GET /api/backup/status`. One implementation, because a second
// one would eventually disagree with the first about what "30 days" means.

// Thirty days is the point at which a month has gone by without anybody taking a copy — long
// enough not to nag a group that downloads at every month end, short enough that it is said while
// the same officials are still in office.
const DEFAULT_STALE_AFTER_DAYS = 30;

function staleAfterDays() {
  const configured = Number(process.env.BACKUP_STALE_DAYS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_STALE_AFTER_DAYS;
}

// Whole days between two instants, floored: a download at 9am yesterday has been off the machine
// for one day by 9am today and not before, so the count never runs ahead of what happened.
function daysSince(from, now) {
  if (!from) return null;
  const elapsed = now - new Date(from).getTime();
  return elapsed < 0 ? 0 : Math.floor(elapsed / 86400000);
}

// The rule on its own, so it can be tested without a database. A group whose last download is
// older than the mark is stale; a group that has never taken one is stale whatever the clock
// says, because there is no age to check — there is nothing.
function describeBackupAge({ lastDownloadAt = null, now = Date.now(), staleDays = staleAfterDays() } = {}) {
  const daysAgo = daysSince(lastDownloadAt, now);
  const never = !lastDownloadAt;
  const stale = never || daysAgo > staleDays;

  let note = null;
  if (never) {
    note =
      'No copy of the books has ever been downloaded, so the only backups are the files this ' +
      "server writes — and a copy sitting on the host is not a copy in somebody's hands.";
  } else if (stale) {
    note =
      `The last copy of the books was taken off this machine ${daysAgo} days ago, past the ` +
      `${staleDays}-day mark. Download a fresh one.`;
  }

  return { daysAgo, never, stale, staleAfterDays: staleDays, note };
}

// The same rule, with the two facts it needs: when a copy last left the machine (read from the
// audit trail, which already records every download, so this cannot drift from what the audit
// screen shows) and what is on the host instead.
async function computeBackupHealth({ now = Date.now() } = {}) {
  // A directory that cannot be read is not an error here: it means this host has never written a
  // backup, which is a thing to say plainly rather than fail over.
  let files = [];
  try {
    files = listBackups(backupDir());
  } catch {
    files = [];
  }

  const lastDownload = await AuditLog.findOne({ 'after.action': 'backup-download' })
    .sort({ createdAt: -1 })
    .populate('performedBy', 'name')
    .lean();

  const newest = files.length ? files[files.length - 1] : null;

  return {
    ...describeBackupAge({ lastDownloadAt: lastDownload?.createdAt || null, now }),
    lastDownload: lastDownload
      ? {
          at: lastDownload.createdAt,
          by: lastDownload.performedBy?.name || null,
          // A slim backup is the data without the document bytes, so it cannot restore on its
          // own — every screen that shows it says so rather than letting it count as a copy.
          slim: Boolean(lastDownload.after?.slim),
        }
      : null,
    onHost: {
      directory: backupDir(),
      // Whether somebody has pointed the job at a mounted volume. False means the files live on
      // the app's own disk, where a redeploy removes them.
      persistent: Boolean(process.env.BACKUP_DIR),
      retention: retentionCount(),
      count: files.length,
      newest: newest ? { name: newest.name, at: new Date(newest.mtimeMs) } : null,
    },
  };
}

module.exports = {
  computeBackupHealth,
  describeBackupAge,
  staleAfterDays,
  DEFAULT_STALE_AFTER_DAYS,
};
