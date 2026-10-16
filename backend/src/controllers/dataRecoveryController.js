const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Settings = require('../models/Settings');
const Contribution = require('../models/Contribution');
const Expense = require('../models/Expense');
const Fine = require('../models/Fine');
const Member = require('../models/Member');
const { getOrCreateSettings, invalidateSettings } = require('../utils/settings');
const { logAudit } = require('../utils/auditLogger');
const { logEvent } = require('../middleware/requestLogger');
const { checkPassword, refuseUnlessConfirmed, phraseMatches } = require('../utils/reauth');
const { parseBackup, planRestore, applyRestore, loadAllModels } = require('../utils/restore');
const { runBackupJob } = require('../jobs/backupJob');

// Putting data back, and taking it away — the two operations that deserve the most ceremony.
//
// Both follow the same rules, because they are the same kind of act:
//
//   * **Maintenance mode must be on.** Anything the office saves while a restore runs is either
//     overwritten by it or interleaved with it; neither is a good outcome for someone's payment.
//   * **The password is asked for again**, and the action is named by typing it.
//   * **A safety copy is written first**, to the same place the nightly backup goes. If that copy
//     cannot be written, nothing else happens: an irreversible step with no way back is exactly
//     the thing a safety copy is for.
//   * **It is audited**, with enough in the entry to say what was done and to which data.
//
// The restore here is the upsert mode only. The destructive "replace" mode — empty each collection
// then load the file — stays on the command line (scripts/restoreBackup.js), where it asks for
// two flags and is run by someone with a terminal open, not a button.

const RESTORE_PHRASE = 'RESTORE';
const RESET_PHRASE = 'RESET REHEARSAL DATA';
const UPLOAD_TTL_MS = 30 * 60 * 1000;
const UPLOAD_PREFIX = 'chama-restore-';

function maxUploadBytes() {
  const mb = Number(process.env.RESTORE_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 50) * 1024 * 1024;
}

// A parsed upload is kept on disk, not in memory: a backup that carries document bytes can be tens
// of megabytes, and holding it between the "look" step and the "do it" step in a process that also
// serves the committee is not a good use of a small instance.
function uploadPath(id) {
  return path.join(os.tmpdir(), `${UPLOAD_PREFIX}${id}.json`);
}

function sweepOldUploads() {
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(UPLOAD_PREFIX)) continue;
      const full = path.join(os.tmpdir(), name);
      if (Date.now() - fs.statSync(full).mtimeMs > UPLOAD_TTL_MS) fs.unlinkSync(full);
    }
  } catch {
    // Housekeeping only.
  }
}

// POST /api/superadmin/restore/inspect — multipart, field "file".
async function inspectBackup(req, res, next) {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ message: 'Choose a backup file to look at.' });
    }
    sweepOldUploads();

    let backup;
    try {
      backup = parseBackup(req.file.buffer.toString('utf8'));
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    const db = mongoose.connection.db;
    const plan = await planRestore({ backup, db });

    const uploadId = crypto.randomBytes(12).toString('hex');
    fs.writeFileSync(uploadPath(uploadId), req.file.buffer);

    const settings = await getOrCreateSettings();
    const warnings = [];
    if (backup.slim === true) {
      warnings.push('This is a data-only copy: the documents’ file contents are not in it, so restoring it would blank them.');
    }
    if (backup.database?.name && backup.database.name !== db.databaseName) {
      warnings.push(`This copy was taken from a database called “${backup.database.name}”, not this one (“${db.databaseName}”).`);
    }
    if (plan.some((row) => row.name === 'users')) {
      warnings.push('It includes the accounts: restoring them puts passwords, roles and two-factor settings back as they were then.');
    }
    if (!settings.maintenanceMode) {
      warnings.push('Maintenance mode is off. Switch it on before restoring, so nobody saves anything in the middle.');
    }

    res.json({
      uploadId,
      expiresInMinutes: UPLOAD_TTL_MS / 60000,
      file: {
        name: req.file.originalname || 'backup.json',
        sizeMb: Number((req.file.size / 1024 / 1024).toFixed(2)),
        takenAt: backup.exportedAt || null,
        by: backup.exportedBy?.name || null,
        fromDatabase: backup.database?.name || null,
        slim: backup.slim === true,
      },
      plan: plan.map((row) => ({
        name: row.name,
        inFile: row.docs,
        inDatabase: row.existing,
        wouldReplace: row.overlapping,
        wouldAdd: row.added,
        modelled: Boolean(row.model),
      })),
      warnings,
      maintenanceOn: Boolean(settings.maintenanceMode),
      phrase: RESTORE_PHRASE,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/superadmin/restore/apply { uploadId, collections, password, phrase }
async function applyBackup(req, res, next) {
  try {
    const { uploadId, collections, phrase } = req.body || {};
    if (!/^[a-f0-9]{24}$/.test(String(uploadId || ''))) {
      return res.status(400).json({ message: 'Look at the file again first — that upload has expired.' });
    }
    const file = uploadPath(uploadId);
    if (!fs.existsSync(file)) {
      return res.status(410).json({ message: 'That upload has expired. Choose the file again.' });
    }
    if (!phraseMatches(phrase, RESTORE_PHRASE)) {
      return res.status(400).json({ message: `Type ${RESTORE_PHRASE} to confirm.` });
    }
    if (refuseUnlessConfirmed(await checkPassword(req), res)) return;

    const settings = await getOrCreateSettings();
    if (!settings.maintenanceMode) {
      return res.status(409).json({
        message: 'Switch maintenance mode on first, so nobody saves anything while the restore runs.',
        code: 'need_maintenance',
      });
    }

    const backup = parseBackup(fs.readFileSync(file, 'utf8'));
    const only = Array.isArray(collections) ? collections.map(String) : [];
    if (only.length === 0) {
      return res.status(400).json({ message: 'Choose at least one collection to restore.' });
    }
    const db = mongoose.connection.db;
    const plan = await planRestore({ backup, db, only });
    if (plan.length === 0) {
      return res.status(400).json({ message: 'None of the chosen collections are in that file.' });
    }

    // The way back, before anything is changed.
    let safety;
    try {
      safety = await runBackupJob({ trigger: 'pre-restore', prune: false });
    } catch (err) {
      return res.status(500).json({
        message: `Nothing was restored: the safety copy could not be written first (${err.message}).`,
      });
    }

    loadAllModels();
    const lines = [];
    const result = await applyRestore({
      backup,
      plan,
      db,
      replace: false,
      log: (line) => lines.push(line.trim()),
    });

    // The restored Settings document carries the maintenance flag as it was when the backup was
    // taken — normally off. The restore is not finished until the super admin says so, so the flag
    // is put back as it was.
    await Settings.updateOne(
      { key: 'main' },
      {
        $set: {
          maintenanceMode: true,
          maintenanceMessage: settings.maintenanceMessage || '',
          maintenanceSince: settings.maintenanceSince || new Date(),
        },
      }
    );
    invalidateSettings();

    await logAudit({
      action: 'reset',
      entityType: 'System',
      entityId: req.user._id,
      performedBy: req.user._id,
      after: {
        action: 'restore-backup',
        via: 'control room',
        takenAt: backup.exportedAt || null,
        mode: 'upsert',
        collections: plan.map((row) => row.name),
        inserted: result.inserted,
        replaced: result.replaced,
        failedCollections: result.failed,
        safetyCopy: safety.file,
      },
    });
    logEvent('restore_applied', { rid: req.id, userId: String(req.user._id), failed: result.failed }, 'warn');

    try {
      fs.unlinkSync(file);
    } catch {
      // Already gone.
    }

    res.json({
      ok: result.failed === 0,
      inserted: result.inserted,
      replaced: result.replaced,
      failed: result.failed,
      perCollection: result.perCollection,
      log: lines,
      safetyCopy: safety.file,
      note:
        result.failed > 0
          ? 'Some collections did not restore cleanly. Read the log before trusting the data.'
          : 'Restored. Check one member against the paper book, then switch maintenance mode off.',
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/superadmin/danger/preview — what a rehearsal reset would remove, counted, so the
// button never has to be pressed blind.
async function resetPreview(req, res, next) {
  try {
    const [contributions, expenses, fines, membersWithDebits] = await Promise.all([
      Contribution.countDocuments({ deleted: false }),
      Expense.countDocuments({ deleted: false }),
      Fine.countDocuments({ deleted: false }),
      Member.countDocuments({ 'fineDebits.0': { $exists: true } }),
    ]);
    res.json({ contributions, expenses, fines, membersWithDebits, phrase: RESET_PHRASE });
  } catch (err) {
    next(err);
  }
}

// POST /api/superadmin/danger/reset-money { password, phrase }
//
// Clears the rehearsal's money — contributions, expenses and fines — and nothing else: no member,
// no account, no setting, no opening balance. Rows are marked deleted, as everywhere else in this
// system ("the app never hard-deletes money"), so the rows are still in the database and in the
// safety copy, and the audit trail still describes them. What the office sees is a clean ledger.
async function resetMoney(req, res, next) {
  try {
    if (!phraseMatches(req.body?.phrase, RESET_PHRASE)) {
      return res.status(400).json({ message: `Type ${RESET_PHRASE} to confirm.` });
    }
    if (refuseUnlessConfirmed(await checkPassword(req), res)) return;

    const settings = await getOrCreateSettings();
    if (!settings.maintenanceMode) {
      return res.status(409).json({
        message: 'Switch maintenance mode on first, so nobody saves anything while the ledger is cleared.',
        code: 'need_maintenance',
      });
    }

    let safety;
    try {
      safety = await runBackupJob({ trigger: 'pre-reset', prune: false });
    } catch (err) {
      return res.status(500).json({
        message: `Nothing was cleared: the safety copy could not be written first (${err.message}).`,
      });
    }

    const [contributions, expenses, fines, members] = await Promise.all([
      Contribution.updateMany({ deleted: false }, { $set: { deleted: true } }),
      Expense.updateMany({ deleted: false }, { $set: { deleted: true } }),
      Fine.updateMany({ deleted: false }, { $set: { deleted: true } }),
      // A fine paid out of a member's balance left a debit on him; the fine is gone, so the debit
      // would otherwise stand as money taken for nothing.
      Member.updateMany({ 'fineDebits.0': { $exists: true } }, { $set: { fineDebits: [] } }),
    ]);

    const counts = {
      contributions: contributions.modifiedCount,
      expenses: expenses.modifiedCount,
      fines: fines.modifiedCount,
      membersWithDebitsCleared: members.modifiedCount,
    };
    await logAudit({
      action: 'reset',
      entityType: 'System',
      entityId: req.user._id,
      performedBy: req.user._id,
      after: { action: 'reset-rehearsal-money', ...counts, safetyCopy: safety.file },
    });
    logEvent('rehearsal_money_reset', { rid: req.id, userId: String(req.user._id), ...counts }, 'warn');

    res.json({ ok: true, ...counts, safetyCopy: safety.file });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  RESTORE_PHRASE,
  RESET_PHRASE,
  maxUploadBytes,
  inspectBackup,
  applyBackup,
  resetPreview,
  resetMoney,
};
