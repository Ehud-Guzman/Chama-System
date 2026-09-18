// Trims the audit trail to a retention window.
//
// The trail is append-only and grows for the life of the group: every contribution,
// every member edit, every reset. That is the point of it — but "we keep everything
// for ever" is a policy somebody has to have chosen, and a table that only grows
// eventually costs more to keep than the records are worth. This makes the choice
// explicit and repeatable instead of leaving it to whoever notices.
//
//   node src/scripts/pruneAuditLog.js                      (dry run, 2 years)
//   node src/scripts/pruneAuditLog.js --days=1825          (dry run, 5 years)
//   node src/scripts/pruneAuditLog.js --days=365 --confirm-write
//   node src/scripts/pruneAuditLog.js --confirm-write --by=chair@example.com
//
// The prune itself is recorded in the trail, so the gap it leaves is explained.
require('dotenv').config();

const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const { resolveScriptActor, operatorEmailFromArgv, logScriptRun } = require('../utils/scriptAudit');

const CONFIRMED = process.argv.includes('--confirm-write');
const DAYS = Number((process.argv.find((a) => a.startsWith('--days=')) || '').slice('--days='.length))
  || 730;

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
  }
  if (!Number.isInteger(DAYS) || DAYS < 30) {
    console.error('--days must be a whole number of at least 30 (a shorter window throws away this year\'s books).');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('MongoDB connected\n');

  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const filter = { createdAt: { $lt: cutoff } };

  const [total, doomed] = await Promise.all([
    AuditLog.countDocuments(),
    AuditLog.countDocuments(filter),
  ]);
  const oldest = await AuditLog.findOne().sort({ createdAt: 1 }).select('createdAt').lean();

  console.log('== audit trail ==');
  console.log(`  entries            ${total}`);
  console.log(`  oldest             ${oldest ? oldest.createdAt.toISOString().slice(0, 10) : '(empty)'}`);
  console.log(`  retention window   ${DAYS} days (before ${cutoff.toISOString().slice(0, 10)})`);
  console.log(`  to be removed      ${doomed}`);
  console.log(`  to be kept         ${total - doomed}`);

  if (doomed === 0) {
    console.log('\nNothing older than the window. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  if (!CONFIRMED) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --confirm-write to prune.');
    await mongoose.disconnect();
    return;
  }

  // Counted by entity *before* the delete so the surviving record says what went.
  const byEntity = await AuditLog.aggregate([
    { $match: filter },
    { $group: { _id: '$entityType', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);

  const actor = await resolveScriptActor(operatorEmailFromArgv());
  const removed = (await AuditLog.deleteMany(filter)).deletedCount;

  await logScriptRun({
    actor,
    action: 'delete',
    summary: {
      action: 'prune-audit-log',
      script: 'src/scripts/pruneAuditLog.js',
      removed,
      kept: total - doomed,
      retentionDays: DAYS,
      cutoff: cutoff.toISOString(),
      byEntity: Object.fromEntries(byEntity.map((row) => [row._id || 'unknown', row.n])),
    },
  });

  console.log(`\nDeleted ${removed} entr${removed === 1 ? 'y' : 'ies'}; ${total - doomed} kept.`);
  console.log('The prune is recorded in the trail that remains.');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nPrune failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
