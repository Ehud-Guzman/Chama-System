// The note a restore leaves in the audit trail must itself verify, whoever took the backup.
//
// A backup downloaded by a signed-in person records that person's id as TEXT in the file. The note used it as
// `performedBy` as it was, so the chain hashed text while the database stored an id, and the restored trail failed the
// very check that proves it is whole (found by restoring a real backup into a scratch database, 2026-10-31). A backup
// made by the nightly job has no person in it, which is why it never showed.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI ? false : 'needs a scratch MongoDB - run npm run test:integration (see the note at the top of this file)';

const TEST_DB = `chama-rehearsal-restorenote-${process.pid}`;
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(`TEST_MONGO_URI (${URI}) does not look like a scratch database - refusing to run.`);
}

const AuditLog = require('../../src/models/AuditLog');
const { logAudit } = require('../../src/utils/auditLogger');
const { verifyChain } = require('../../src/utils/auditChain');
const { recordRestore } = require('../../src/utils/restore');

const chain = async () => verifyChain(await AuditLog.find({ chainSequence: { $ne: null } }).sort({ chainSequence: 1 }).lean());

test.before(async () => {
  if (skip) return;
  await mongoose.connect(targetFor(TEST_DB), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
});

test.after(async () => {
  if (skip) return;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
});

test('the restore note verifies when the backup was taken by a person (their id is text in the file)', { skip }, async () => {
  const who = new mongoose.Types.ObjectId();
  await logAudit({ action: 'create', entityType: 'Member', entityId: new mongoose.Types.ObjectId(), performedBy: who, after: { name: 'Before' } });

  const backup = { exportedBy: { id: String(who), name: 'A signed-in user' } };
  const note = await recordRestore({ backup, file: 'backup.json', target: 'somewhere', replace: false, collections: 12 });
  assert.ok(note, 'the note was written');
  assert.equal(note.chainSequence, 2, 'and it joined the chain');
  assert.equal((await chain()).ok, true, JSON.stringify(await chain()));
});

test('the restore note verifies when the backup has no person in it, or one that is not an id, and twice in a row', { skip }, async () => {
  for (const exportedBy of [undefined, null, {}, { name: 'nightly backup' }, { id: 'not-an-id' }]) {
    await recordRestore({ backup: { exportedBy }, file: 'b.json', target: 'x', replace: true, collections: 3 });
  }
  const all = await AuditLog.find({ chainSequence: { $ne: null } }).lean();
  assert.ok(all.length >= 7);
  assert.equal((await chain()).ok, true, JSON.stringify(await chain()));
});

test('a collection no model owns can be restored twice into the same database without a failure', { skip }, async () => {
  const { applyRestore } = require('../../src/utils/restore');
  const db = mongoose.connection.db;
  const rows = [{ _id: 'login-spray:127.0.0.1', totalHits: 3 }, { _id: 'login:1.2.3.4', totalHits: 1 }];
  const plan = [{ name: 'scratchcounters', docs: rows.length, existing: 0, overlapping: 0, added: rows.length, model: null }];
  const backup = { data: { scratchcounters: rows } };
  const logs = [];
  const run = () => applyRestore({ backup, plan, db, replace: false, log: (line, level) => logs.push([level, line]) });

  const first = await run();
  assert.equal(first.failed, 0);
  assert.equal(first.inserted, 2);
  const second = await run();
  assert.equal(second.failed, 0, JSON.stringify(logs));
  assert.equal(await db.collection('scratchcounters').countDocuments(), 2, 'nothing was duplicated');
  await db.collection('scratchcounters').drop().catch(() => {});
});
