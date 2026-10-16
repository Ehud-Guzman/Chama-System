/**
 * Restore a backup taken with GET /api/backup (Backup panel, super admin only).
 *
 * Until this existed the system could hand you a copy of the database and had no way
 * to read it back — which makes the backup a hope rather than a backup. This is the
 * other half: it reads the file, reports exactly what it would write, and only writes
 * when you say so.
 *
 *   node src/scripts/restoreBackup.js <file.json>                    dry run
 *   node src/scripts/restoreBackup.js <file.json> --confirm-write
 *   node src/scripts/restoreBackup.js backup.json --target=mongodb://127.0.0.1:27017/chama-rehearsal --confirm-write
 *   node src/scripts/restoreBackup.js backup.json --only=members,settings --confirm-write
 *   node src/scripts/restoreBackup.js backup.json --replace --confirm-write
 *
 * The reading, the planning and the writing live in utils/restore, which the Control Room's
 * restore (super admin, upsert mode only) uses as well — one implementation of the operation that
 * is only ever run when something has already gone wrong.
 *
 * How it writes
 *
 *   Default is an **upsert by `_id`**: every document in the file is written under its
 *   own id, existing rows are replaced, and collections that are not in the file are
 *   left alone. That is the mode which cannot lose data that is not in the backup.
 *
 *   `--replace` empties each collection in the file first — a true restore to the
 *   moment the backup was taken, including rows deleted since. That is the mode you
 *   want after a disaster, and the one that can lose a day's entries if run by mistake.
 *
 * Restoring onto the *same* database the backup came from (a real recovery) also needs
 * `--replace-live`: two deliberate keys, because that is the operation which
 * overwrites the group's live books.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
  loadAllModels,
  reviveBuffers,
  readBackupFile,
  planRestore,
  applyRestore,
} = require('../utils/restore');

loadAllModels();

const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--'));
const CONFIRMED = argv.includes('--confirm-write');
const REPLACE = argv.includes('--replace');
const REPLACE_LIVE = argv.includes('--replace-live');
const TARGET = (argv.find((a) => a.startsWith('--target=')) || '').slice('--target='.length);
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '')
  .slice('--only='.length)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  if (!FILE) {
    fail('Name the backup file: node src/scripts/restoreBackup.js <file.json> [--confirm-write]');
  }
  const filePath = path.resolve(FILE);
  if (!fs.existsSync(filePath)) fail(`No file at ${filePath}`);

  let backup;
  try {
    backup = readBackupFile(filePath);
  } catch (err) {
    fail(err.message);
  }

  const uri = TARGET || process.env.MONGO_URI;
  if (!uri) fail('MONGO_URI is not set and no --target was given.');

  console.log('== the file ==');
  console.log(`  path          ${filePath}`);
  console.log(`  taken         ${backup.exportedAt || '(unknown)'}`);
  console.log(`  by            ${backup.exportedBy?.name || '(unknown)'}`);
  console.log(`  from database ${backup.database?.name || '(unknown)'}`);
  console.log(
    `  slim          ${backup.slim === true ? 'yes — document bytes are NOT in this file' : 'no'}`
  );
  console.log(
    `  collections   ${Object.keys(backup.data).length}${ONLY.length ? ' (filtered by --only)' : ''}`
  );

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, bufferCommands: false });
  const db = mongoose.connection.db;
  const targetName = db.databaseName;

  console.log('\n== the target ==');
  console.log(`  database      ${targetName}`);
  console.log(
    `  mode          ${REPLACE ? 'REPLACE (each collection emptied first)' : 'upsert by _id'}`
  );

  if (targetName === backup.database?.name && !REPLACE_LIVE) {
    console.error(
      '\n  That is the database the backup was taken from, so this is a real recovery\n' +
        '  rather than a rehearsal. Nothing has been written.\n\n' +
        '  Rehearse it on a scratch database first:\n' +
        `    node src/scripts/restoreBackup.js "${filePath}" --target=mongodb://127.0.0.1:27017/chama-rehearsal --confirm-write\n\n` +
        '  If you do mean to recover onto the live database, add --replace-live as well.\n'
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const plan = await planRestore({ backup, db, only: ONLY });

  console.log('\n== what would be written ==');
  for (const row of plan) {
    const via = row.model ? row.model.modelName : 'raw driver (no model)';
    console.log(
      `  ${row.name.padEnd(22)} file ${String(row.docs).padStart(5)}   in database ${String(
        row.existing
      ).padStart(5)}   via ${via}`
    );
  }
  const totalDocs = plan.reduce((sum, row) => sum + row.docs, 0);
  console.log(`  ${'total'.padEnd(22)} ${String(totalDocs).padStart(10)} documents`);

  if (!CONFIRMED) {
    console.log('\nDRY RUN — nothing written. Re-run with --confirm-write to restore.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n== writing ==');
  const result = await applyRestore({
    backup,
    plan,
    db,
    replace: REPLACE,
    log: (line, level) => (level === 'error' ? console.error(line) : console.log(line)),
  });

  // Restoring writes the whole register, so it leaves the trace a reset does: what file,
  // onto which database, and in which mode. Written even when the file carried the audit
  // trail itself — that trail ends at the moment the backup was taken, so without this
  // entry the restored database has no record of having been restored.
  const AuditLog = mongoose.models.AuditLog;
  if (AuditLog) {
    await AuditLog.create({
      action: 'reset',
      entityType: 'System',
      entityId: new mongoose.Types.ObjectId(),
      performedBy: backup.exportedBy?.id || new mongoose.Types.ObjectId(),
      after: {
        action: 'restore-backup',
        file: path.basename(filePath),
        target: targetName,
        mode: REPLACE ? 'replace' : 'upsert',
        collections: plan.length,
      },
    });
  }

  console.log(
    `\n== done ==\n  ${result.inserted} inserted, ${result.replaced} replaced, ${result.failed} collection(s) failed`
  );
  if (result.failed) {
    console.log(
      '  Read the failures above before trusting this database — a partial restore is not a restore.'
    );
  }
  console.log(`  Check one member against the paper book before using ${targetName}.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('\nRestore failed:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { reviveBuffers };
