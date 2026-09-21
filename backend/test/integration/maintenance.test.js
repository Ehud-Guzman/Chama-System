// The rehearsal for everything that runs without a person watching: the audit chain and the
// scheduled jobs.
//
// These cannot be tested with pure functions, because their whole point is what they do to a
// database and a disk: an entry is written, then somebody edits the stored document, and the
// question is whether the trail notices. A backup is written to a file and the question is
// whether the file can be read back. So this suite runs against a real MongoDB like the money
// rehearsal does, with the same guard against pointing it anywhere real.
//
//   npm run test:integration
//   docker run -d --name chama-rehearsal -p 27017:27017 mongo:7
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';

const TEST_DB = 'chama-rehearsal-maintenance';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(
    `TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run. ` +
      'Name it with "rehearsal", "scratch" or "test" in it.'
  );
}

const User = require('../../src/models/User');
const AuditLog = require('../../src/models/AuditLog');
const JobRun = require('../../src/models/JobRun');
const JobLock = require('../../src/models/JobLock');
const { logAudit } = require('../../src/utils/auditLogger');
const { verifyChain } = require('../../src/utils/auditChain');
const {
  executeJob,
  acquireLease,
  releaseLease,
  findDefinition,
  listDefinitions,
  jobsEnabled,
} = require('../../src/jobs');
const { runBackupJob } = require('../../src/jobs/backupJob');
const { walkChain } = require('../../src/jobs/auditJob');

let actor;
let backupDir;

test.before(async () => {
  if (skip) return;

  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();

  actor = await User.create({
    name: 'Rehearsal Super Admin',
    email: 'rehearsal@example.com',
    password: 'not-a-real-hash',
    role: 'super_admin',
  });

  // Somewhere disposable: a real directory the job can write into, thrown away afterwards.
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chama-backup-'));
  process.env.BACKUP_DIR = backupDir;
  process.env.BACKUP_RETENTION = '3';
});

test.after(async () => {
  if (skip) return;
  if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true });
  delete process.env.BACKUP_DIR;
  delete process.env.BACKUP_RETENTION;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// -----------------------------------------------------------------------------
// The chain
// -----------------------------------------------------------------------------

test('entries written through logAudit form a chain that verifies', { skip }, async () => {
  for (let index = 0; index < 5; index += 1) {
    await logAudit({
      action: 'update',
      entityType: 'Member',
      entityId: actor._id,
      performedBy: actor._id,
      before: { openingBalance: index * 100 },
      after: { openingBalance: (index + 1) * 100 },
    });
  }

  const entries = await AuditLog.find({ chainSequence: { $ne: null } })
    .sort({ chainSequence: 1 })
    .lean();

  assert.equal(entries.length, 5);
  // The first entry of an empty trail chains from genesis.
  assert.equal(entries[0].chainSequence, 1);
  assert.match(entries[0].prevHash, /^0{64}$/);

  const result = verifyChain(entries);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.verified, 5);
  // The recorded head is the last entry's hash: what gets written down as the anchor.
  assert.equal(result.head, entries[4].hash);
});

test('editing a stored entry in the database breaks the chain, and is named', { skip }, async () => {
  const target = await AuditLog.findOne({ chainSequence: 3 });
  // Straight past the API and the model: this is the attack the chain exists for. Whoever can
  // edit the books can edit a document.
  await AuditLog.collection.updateOne(
    { _id: target._id },
    { $set: { 'after.openingBalance': 999999 } }
  );

  const result = await walkChain();
  assert.equal(result.ok, false);
  assert.equal(result.break.reason, 'content');
  assert.equal(result.break.chainSequence, 3);
  assert.match(result.break.message, /altered/);

  // Put it back, so the rest of the file starts from an intact chain.
  await AuditLog.collection.updateOne(
    { _id: target._id },
    { $set: { 'after.openingBalance': 300 } }
  );
  assert.equal((await walkChain()).ok, true);
});

test('deleting a stored entry leaves a gap the verifier reports', { skip }, async () => {
  const target = await AuditLog.findOne({ chainSequence: 2 });
  const removed = target.toObject();
  await AuditLog.collection.deleteOne({ _id: target._id });

  const result = await walkChain();
  assert.equal(result.ok, false);
  assert.equal(result.break.reason, 'gap');

  // Restore it with the same chain fields, so the chain is intact again and the sequence the
  // later tests rely on still holds.
  await AuditLog.collection.insertOne(removed);
  assert.equal((await walkChain()).ok, true);
});

// -----------------------------------------------------------------------------
// The job runner
// -----------------------------------------------------------------------------

test('a job that works is recorded as a run, with its summary', { skip }, async () => {
  const definition = {
    name: 'rehearsal-ok',
    schedule: () => 'daily@02:00',
    run: async () => ({ did: 'something', amount: 1400 }),
  };

  const result = await executeJob(definition, { trigger: 'manual', holder: 'test' });
  assert.equal(result.ok, true);

  const recorded = await JobRun.findOne({ name: 'rehearsal-ok' }).sort({ startedAt: -1 }).lean();
  assert.equal(recorded.ok, true);
  assert.equal(recorded.trigger, 'manual');
  assert.equal(recorded.summary.amount, 1400);
  assert.ok(recorded.durationMs >= 0);
});

test('a job that throws is recorded as a failure rather than taking anything down', { skip }, async () => {
  const definition = {
    name: 'rehearsal-fail',
    schedule: () => 'daily@02:00',
    run: async () => {
      throw new Error('the disk is full');
    },
  };

  const result = await executeJob(definition, { trigger: 'manual', holder: 'test' });
  // The runner reports the failure to its caller instead of throwing: a job that crashes the
  // API is worse than a job that did not run.
  assert.equal(result.ok, false);
  assert.equal(result.error, 'the disk is full');

  const recorded = await JobRun.findOne({ name: 'rehearsal-fail' }).lean();
  assert.equal(recorded.ok, false);
  assert.equal(recorded.error, 'the disk is full');
});

test('a lease stops a second instance running the same job', { skip }, async () => {
  assert.equal(await acquireLease('rehearsal-lease', 'instance-a'), true);
  // The same job, from somewhere else, at the same moment.
  assert.equal(await acquireLease('rehearsal-lease', 'instance-b'), false);

  // And a run that respects the lease is skipped rather than doubled.
  let ran = 0;
  const definition = {
    name: 'rehearsal-lease',
    schedule: () => 'daily@02:00',
    run: async () => {
      ran += 1;
      return {};
    },
  };
  const blocked = await executeJob(definition, { trigger: 'schedule', holder: 'instance-b' });
  assert.equal(blocked.skipped, true);
  assert.equal(ran, 0);

  // Released by the holder, so the next attempt goes through.
  await releaseLease('rehearsal-lease', 'ok');
  const allowed = await executeJob(definition, { trigger: 'schedule', holder: 'instance-b' });
  assert.equal(allowed.ok, true);
  assert.equal(ran, 1);
});

test('a lease left behind by a killed process is stealable, not permanent', { skip }, async () => {
  // The failure this guards against: a container killed mid-job leaves the lock set, and the
  // nightly backup never happens again.
  await JobLock.updateOne(
    { name: 'rehearsal-lease' },
    { $set: { lockedUntil: new Date(Date.now() - 60_000) } }
  );
  assert.equal(await acquireLease('rehearsal-lease', 'instance-c'), true);
  await releaseLease('rehearsal-lease', 'ok');
});

test('every registered job has a schedule that parses', { skip }, async () => {
  for (const definition of listDefinitions()) {
    assert.equal(definition.error, null, `${definition.name}: ${definition.error}`);
    assert.ok(definition.nextRunAt, `${definition.name} has no next run`);
    assert.ok(definition.nextRunIn);
  }
  assert.equal(jobsEnabled(), true);
});

test('the stored documents are what verify, key order and all', { skip }, async () => {
  // The verifier recomputes from what the driver hands back, not from what the writer held in
  // memory. This is the check that the canonical form really does survive a round trip through
  // BSON — the failure it guards against is a verifier that cries wolf on an untouched trail,
  // which would train everybody to ignore it.
  const result = await walkChain();
  assert.equal(result.ok, true, result.break && result.break.message);
  assert.equal(result.checked, 5);
});

// -----------------------------------------------------------------------------
// The backup
// -----------------------------------------------------------------------------

test('the nightly backup writes a file that can be read back', { skip }, async () => {
  const summary = await runBackupJob({ trigger: 'manual' });

  assert.equal(summary.collections > 0, true);
  assert.ok(summary.sizeBytes > 0);

  const written = path.join(backupDir, summary.file);
  assert.equal(fs.existsSync(written), true);

  // Parsed as JSON, not read as text: a backup that only *looks* like JSON is the failure mode
  // the format exists to prevent.
  const parsed = JSON.parse(fs.readFileSync(written, 'utf8'));
  assert.equal(parsed.format, 'chama-system-backup');
  assert.equal(parsed.version, 2);
  assert.equal(parsed.slim, false);
  assert.equal(parsed.exportedBy.name, 'nightly backup (scheduled job)');

  // The collections that exist are in it, and `users` came along — the file is restorable,
  // which is what makes it worth having.
  assert.ok(Array.isArray(parsed.data.users));
  assert.equal(parsed.data.users.length, 1);
  assert.equal(parsed.data.auditlogs.length, 5);

  // The date bug, asserted at the file level: a date is `{$date: ISO}`, never `{}`.
  const stored = parsed.data.users[0].createdAt;
  assert.equal(typeof stored, 'object');
  assert.match(stored.$date, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(!Number.isNaN(Date.parse(stored.$date)));
});

test('a second run in the same second never overwrites the first backup', { skip }, async () => {
  // The file name has second resolution, and "run now" pressed while the scheduled run is
  // finishing lands in the same second. Overwriting a backup with another backup is the worst
  // kind of quiet loss: the file you believed you had is gone and nothing says so.
  const first = await runBackupJob({ trigger: 'manual' });
  const second = await runBackupJob({ trigger: 'manual' });

  assert.notEqual(first.file, second.file);
  assert.equal(fs.existsSync(path.join(backupDir, first.file)), true);
  assert.equal(fs.existsSync(path.join(backupDir, second.file)), true);
  // Both are still real, readable backups — not an empty file where the first one was.
  for (const name of [first.file, second.file]) {
    const parsed = JSON.parse(fs.readFileSync(path.join(backupDir, name), 'utf8'));
    assert.equal(parsed.version, 2);
  }
});

test('retention keeps the newest backups and deletes only its own files', { skip }, async () => {
  // A stray file in the same directory — somebody's notes, another program's output — must
  // survive the job's housekeeping. This is the check that the retention glob is narrow.
  const stray = path.join(backupDir, 'do-not-delete-me.txt');
  fs.writeFileSync(stray, 'not a backup');

  for (let run = 0; run < 4; run += 1) {
    await runBackupJob({ trigger: 'manual' });
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const files = fs.readdirSync(backupDir).filter((name) => name.startsWith('chama-backup-'));
  // BACKUP_RETENTION is 3 in this file.
  assert.equal(files.length, 3);
  assert.equal(fs.existsSync(stray), true);
});

// -----------------------------------------------------------------------------
// The audit check
// -----------------------------------------------------------------------------

test('the audit job verifies the trail and reports the head it should', { skip }, async () => {
  // Run through the real registry entry, so this covers the definition the timer uses as well
  // as the job body — and so the run is recorded like any other.
  const result = await executeJob(findDefinition('audit-check'), { trigger: 'manual', holder: 'test' });
  assert.equal(result.ok, true);
  const summary = result.summary;

  assert.equal(summary.ok, true);
  assert.equal(summary.chainedEntries, 5);

  const newest = await AuditLog.findOne({ chainSequence: { $ne: null } })
    .sort({ chainSequence: -1 })
    .lean();
  // The head in the summary is the anchor that gets written down and emailed. If it did not
  // match the newest entry, comparing it next week would prove nothing at all.
  assert.equal(summary.head, newest.hash);

  const recorded = await JobRun.findOne({ name: 'audit-check' }).sort({ startedAt: -1 }).lean();
  assert.equal(recorded.ok, true);
  assert.equal(recorded.summary.head, newest.hash);
});

test('the audit job reports a broken trail instead of throwing', { skip }, async () => {
  const target = await AuditLog.findOne({ chainSequence: 4 });
  await AuditLog.collection.updateOne({ _id: target._id }, { $set: { action: 'delete' } });

  const result = await executeJob(findDefinition('audit-check'), { trigger: 'manual', holder: 'test' });

  // The *job* still succeeded — it did its work, which was finding out and saying so. The
  // trail's verdict is what came back false, and that distinction matters: a job recorded as
  // crashed would send somebody looking for a bug in the job.
  assert.equal(result.ok, true);
  assert.equal(result.summary.ok, false);
  assert.equal(result.summary.break.reason, 'content');
  assert.equal(result.summary.break.sequence, 4);

  const recorded = await JobRun.findOne({ name: 'audit-check' }).sort({ startedAt: -1 }).lean();
  assert.equal(recorded.ok, true);
  assert.equal(recorded.summary.ok, false);

  await AuditLog.collection.updateOne({ _id: target._id }, { $set: { action: 'update' } });
  assert.equal((await walkChain()).ok, true);
});
