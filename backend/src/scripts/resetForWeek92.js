/**
 * Week-92 reset — the go-live wipe.
 *
 * WHAT IT DOES, in order:
 *
 *   1. backs up every collection it is about to touch, to backend/data/
 *   2. rolls each member's current ledger balance into `openingBalance`, so his
 *      money starts where the paper ledger left him instead of at zero
 *   3. clears contributions, expenses, fines, fine types, contribution types
 *      and pledges
 *   4. reseeds the three ledger types (Weekly Contribution, Chai, Extra
 *      Contributions) and the disciplinary infraction types
 *
 * Members, accounts, minutes, chama documents, the constitution and Settings
 * are never deleted — except each member's openingBalance, which is the point.
 *
 * Usage:
 *
 *   Dry run (the default — writes nothing, prints the whole plan):
 *     node src/scripts/resetForWeek92.js
 *
 *   Apply:
 *     node src/scripts/resetForWeek92.js --confirm-reset
 *
 *   Extra switches:
 *     --remove-artifacts        also delete the two pseudo-members an old import
 *                               script created ("Opening Balances …" — group totals
 *                               stored as if they were people)
 *     --clear-audit             also empty the audit trail. Kept by default: after a
 *                               wipe it is the only record of what the wipe removed.
 *                               Needs --i-know-what-this-does as well — the reset
 *                               writes its own entry afterwards, so an emptied trail
 *                               still says what happened.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const FineType = require('../models/FineType');
const User = require('../models/User');

const { logAudit } = require('../utils/auditLogger');
const { getOrCreateSettings } = require('../utils/settings');
const { resolveConfig, toEatDateString } = require('../utils/weekCycle');
const { seedLedgerTypes, syncLedgerTypeAmounts, LEDGER_TYPES } = require('../utils/ledgerTypes');
const { seedDisciplinaryFineTypes } = require('../utils/seedDisciplinaryFineTypes');
const { suggestedOpeningBalances } = require('../utils/suggestedBalances');

const CONFIRMED = process.argv.includes('--confirm-reset');
const REMOVE_ARTIFACTS = process.argv.includes('--remove-artifacts');
const CLEAR_AUDIT =
  process.argv.includes('--clear-audit') && process.argv.includes('--i-know-what-this-does');

// The pseudo-members an old import created to hold group-level totals. Matched
// by name so a real member can never be caught by this, whatever else changes.
const ARTIFACT_NAME = /^opening balances/i;

// Collections emptied by the reset, as raw driver names so the backup and the
// counts describe exactly the same sets of documents.
const CLEARED = ['contributions', 'expenses', 'fines', 'finetypes', 'contributiontypes', 'pledges'];

function money(n) {
  return 'Ksh ' + Number(n || 0).toLocaleString('en-KE');
}

// The plan, printed in full before anything is written — a dry run has to be
// enough on its own to decide whether to go ahead.
(async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  console.log('MongoDB connected\n');

  const settings = await getOrCreateSettings();
  const config = resolveConfig(settings);
  const members = await Member.find().sort({ name: 1 }).lean();
  const held = await suggestedOpeningBalances();
  const artifacts = members.filter((m) => ARTIFACT_NAME.test(m.name));
  const people = members.filter((m) => !ARTIFACT_NAME.test(m.name));

  console.log('== week cycle ==');
  console.log('  week', config.cycleStartWeek, 'starting (EAT)', toEatDateString(config.anchorDate));
  console.log('  required each week', money(config.weeklyAmount), '| tea each week', money(config.chaiAmount));

  console.log('\n== opening balances ==');
  let total = 0;
  let willWrite = 0;
  for (const m of people) {
    const suggested = held.get(String(m._id)) || 0;
    const current = Number(m.openingBalance) || 0;
    total += current || suggested;
    let verdict;
    if (current > 0) verdict = `KEEP existing ${money(current)} (ledger says ${money(suggested)})`;
    else if (suggested > 0) {
      verdict = `SET ${money(suggested)}`;
      willWrite += 1;
    } else verdict = 'nothing to carry forward';
    console.log(`  ${m.name.padEnd(24)} ${String(m.regNumber || '').padEnd(9)} ${verdict}`);
  }
  console.log(`  -> ${people.length} members, ${willWrite} to be written, total held ${money(total)}`);

  console.log('\n== documents to be cleared ==');
  for (const name of CLEARED) {
    console.log(`  ${name.padEnd(20)} ${String(await db.collection(name).countDocuments()).padStart(6)} documents`);
  }
  if (CLEAR_AUDIT) {
    const n = await db.collection('auditlogs').countDocuments();
    console.log(`  ${'auditlogs'.padEnd(20)} ${String(n).padStart(6)} documents (--clear-audit)`);
  }
  console.log('  reseeded afterwards:', LEDGER_TYPES.map((t) => t.name).join(', '), '+ disciplinary fine types');

  console.log('\n== kept untouched ==');
  for (const name of ['members', 'users', 'minutes', 'chamadocuments', 'settings', 'counters']) {
    console.log(`  ${name.padEnd(20)} ${String(await db.collection(name).countDocuments()).padStart(6)} documents`);
  }

  if (artifacts.length) {
    console.log('\n== import artefacts (group totals stored as members) ==');
    for (const a of artifacts) {
      const n = await Contribution.countDocuments({ memberId: a._id });
      console.log(`  ${a.name} (${a.regNumber || 'no reg'}) — ${a.active ? 'active' : 'inactive'}, ${n} contribution row(s)`);
    }
    console.log(
      REMOVE_ARTIFACTS
        ? '  -> will be deleted (--remove-artifacts)'
        : '  -> kept. Their money rows are cleared either way; add --remove-artifacts to delete them.'
    );
  }

  if (!CONFIRMED) {
    console.log('\nDRY RUN — nothing was written.');
    console.log('Re-run with --confirm-reset to apply.');
    if (!REMOVE_ARTIFACTS) console.log('Add --remove-artifacts to also delete the pseudo-members above.');
    await mongoose.disconnect();
    return;
  }

  // --- backup ---------------------------------------------------------------
  // Written before anything is deleted, so a reset that turns out to be wrong is
  // always recoverable. Gitignored: it holds real names, phones and balances.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.resolve(__dirname, '../../data', `reset-backup-${stamp}.json`);
  const backup = {
    takenAt: new Date().toISOString(),
    weekCycle: {
      cycleStartWeek: config.cycleStartWeek,
      weekAnchorDate: toEatDateString(config.anchorDate),
      weeklyAmount: config.weeklyAmount,
      chaiAmount: config.chaiAmount,
    },
    artifactsToRemove: REMOVE_ARTIFACTS ? artifacts.map((a) => a.regNumber || a.name) : [],
    collections: {},
  };
  for (const name of [...CLEARED, 'members', 'settings']) {
    backup.collections[name] = await db.collection(name).find({}).toArray();
  }
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(backup));
  console.log(`\nbackup written: ${backupPath} (${(fs.statSync(backupPath).size / 1024).toFixed(0)} KB)`);

  // --- 1. opening balances --------------------------------------------------
  let written = 0;
  for (const m of people) {
    const suggested = held.get(String(m._id)) || 0;
    // A balance already set is never overwritten: if the treasurer has since
    // corrected a figure by hand, that correction wins over the ledger sum.
    if ((Number(m.openingBalance) || 0) > 0 || suggested <= 0) continue;
    await Member.updateOne(
      { _id: m._id },
      { $set: { openingBalance: suggested, openingBalanceNote: 'Week-92 reset from the paper ledger' } }
    );
    written += 1;
  }
  console.log(`opening balances written: ${written}`);

  // --- 2. artefacts ---------------------------------------------------------
  if (REMOVE_ARTIFACTS && artifacts.length) {
    await Member.deleteMany({ _id: { $in: artifacts.map((a) => a._id) } });
    console.log(`pseudo-members removed: ${artifacts.length} (${artifacts.map((a) => a.name).join(', ')})`);
  }

  // --- 3. clear -------------------------------------------------------------
  for (const name of CLEARED) {
    const res = await db.collection(name).deleteMany({});
    console.log(`cleared ${name.padEnd(20)} ${res.deletedCount}`);
  }
  if (CLEAR_AUDIT) {
    const res = await db.collection('auditlogs').deleteMany({});
    console.log(`cleared ${'auditlogs'.padEnd(20)} ${res.deletedCount}`);
  }

  // --- 4. reseed ------------------------------------------------------------
  await seedLedgerTypes();
  await syncLedgerTypeAmounts(settings);
  await seedDisciplinaryFineTypes();
  const types = await ContributionType.find().select('name').lean();
  console.log('contribution types now:', types.map((t) => t.name).join(', '));
  console.log('fine types:', (await FineType.find().select('name category').lean()).map((t) => t.name).join(', '));

  // The reset leaves a record of itself — with --clear-audit it becomes the only
  // entry in the trail, which is exactly what should be there.
  const admin = await User.findOne({ role: 'super_admin' }).lean();
  if (admin) {
    await logAudit({
      action: 'reset',
      entityType: 'System',
      entityId: settings._id,
      performedBy: admin._id,
      before: {
        cleared: CLEARED,
        artifactsRemoved: REMOVE_ARTIFACTS ? artifacts.map((a) => a.name) : [],
      },
      after: {
        weekCycle: backup.weekCycle,
        openingBalancesWritten: written,
        script: 'src/scripts/resetForWeek92.js',
      },
    });
    console.log('audit entry written for the reset');
  }

  console.log(`\nReset complete. Open /admin/finance to start week ${config.cycleStartWeek}.`);
  await mongoose.disconnect();

})().catch(async (err) => {
  console.error('\nRESET FAILED:', err.message);
  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  process.exit(1);
});
