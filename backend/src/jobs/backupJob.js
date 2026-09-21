// The nightly backup.
//
// Until this existed, a backup happened only if somebody opened Admin → Backup and pressed
// download, which means the real answer to "how old is the group's most recent backup?" was
// "whenever the last person happened to remember". Every other safety net in this system —
// the audit trail, the soft deletes, the money rounding — protects against a mistake. This is
// the one that protects against the database itself being gone.
//
// Where the file goes: `backend/data/backups/` by default, which is gitignored for the same
// reason the old import scripts are — it carries real names, phone numbers and balances, and
// a backup in a git repository is a leak with a long memory. On a host with an ephemeral
// disk (Render, Railway) that directory does not survive a deploy, so this is only half the
// job: set `BACKUP_DIR` to a mounted volume, or copy the directory off the host, and the
// README says so. A backup that lives on the machine it is backing up is not a backup.
const fs = require('fs');
const path = require('path');
const { writeBackupJson, filenameDate } = require('../utils/backup');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'backups');

function backupDir() {
  return process.env.BACKUP_DIR || DEFAULT_DIR;
}

function retentionCount() {
  const configured = Number(process.env.BACKUP_RETENTION);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 14;
}

// Anything this job wrote, so nothing else in that directory is ever deleted by it. A
// retention rule that matches too broadly is how a backup script eats its own directory.
//
// The shape is `filenameDate`'s (utils/backup): `2026-09-21T12:00:00.000Z` → the first 19
// characters with `:` and `T` replaced by `-`, so `2026-09-21-12-00-00`. Written as an explicit
// pattern rather than anything cleverer because this regex decides what gets deleted, and the
// first version of it required a `T` that never appears — which silently matched nothing, so
// the retention rule never fired and old backups accumulated forever. There is a test for it.
const BACKUP_FILE = /^chama-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}(-\d+)?\.json$/;

// A name no other backup already holds.
//
// The file name is second-resolution, and two runs inside one second would otherwise write to
// the same path — the second silently replacing the first. That happens when somebody presses
// "run now" while the scheduled run is finishing, and the cost is the worst kind: a backup you
// believed you had. So an existing name is never reused; a counter is appended instead.
function uniqueName(dir, fileName) {
  if (!fs.existsSync(path.join(dir, fileName))) return fileName;
  const stem = fileName.replace(/\.json$/, '');
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${stem}-${suffix}.json`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  throw new Error(`Cannot find a free backup file name in ${dir}`);
}

function listBackups(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => BACKUP_FILE.test(name))
    .map((name) => {
      const full = path.join(dir, name);
      return { name, full, size: fs.statSync(full).size, mtimeMs: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
}

// Keeps the newest `retention` files and returns what it removed.
function pruneBackups(dir, retention) {
  const files = listBackups(dir);
  const doomed = files.slice(0, Math.max(0, files.length - retention));
  for (const file of doomed) {
    try {
      fs.unlinkSync(file.full);
    } catch {
      // A file that cannot be removed is not a reason for the backup to report failure. It
      // will be caught by the next run's count, which is what the summary is for.
    }
  }
  return doomed.map((file) => file.name);
}

async function runBackupJob({ trigger = 'schedule' } = {}) {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });

  const fileName = uniqueName(dir, `chama-backup-${filenameDate(new Date())}.json`);
  const target = path.join(dir, fileName);
  const stream = fs.createWriteStream(target, { encoding: 'utf8' });

  // The stream's backpressure, handed to writeBackupJson as a promise: it awaits this, so a
  // slow disk throttles the database read rather than filling the process's memory with a
  // file it has not managed to write yet.
  const write = (chunk) =>
    new Promise((resolve, reject) => {
      stream.once('error', reject);
      if (stream.write(chunk, 'utf8')) resolve();
      else stream.once('drain', resolve);
    });

  let result;
  try {
    result = await writeBackupJson(write, {
      slim: false,
      // The file is the database as it stands, and `exportedBy` says why it exists. It is
      // read months later by somebody deciding whether this backup is the right one.
      exportedBy: { id: null, name: 'nightly backup (scheduled job)', role: 'system', trigger },
    });
  } finally {
    await new Promise((resolve) => stream.end(resolve));
  }

  const size = fs.statSync(target).size;
  const removed = pruneBackups(dir, retentionCount());

  return {
    file: fileName,
    path: target,
    sizeBytes: size,
    sizeMb: Number((size / 1024 / 1024).toFixed(2)),
    collections: result.collections.length,
    counts: result.counts,
    retention: retentionCount(),
    pruned: removed,
    directory: dir,
  };
}

module.exports = { runBackupJob, backupDir, retentionCount, listBackups, pruneBackups, uniqueName, BACKUP_FILE };
