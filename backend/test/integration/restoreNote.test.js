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

// Found by restoring the real Wazo Moja backup (2026-10-31): 113 audit entries from the first days, before the chain
// existed, have NO `chainSequence` in the file. The restore passed each document through the model, which filled the
// missing field with an explicit `null`, and the database's unique index on that field allows only one `null`, so 112
// of the earliest audit entries were silently dropped ("a partial restore"). A restore reproduces the file: a field that
// is absent stays absent.
test('entries from before the audit chain (no chainSequence) are all restored, and stay without one', { skip }, async () => {
  const { applyRestore } = require('../../src/utils/restore');
  const db = mongoose.connection.db;
  await db.collection('auditlogs').deleteMany({});
  const id = () => new mongoose.Types.ObjectId().toString();
  const legacy = (n) => ({ _id: id(), action: 'update', entityType: 'Member', entityId: id(), performedBy: id(), before: { n }, after: { n: n + 1 }, createdAt: { $date: '2026-09-18T06:53:11.338Z' }, updatedAt: { $date: '2026-09-18T06:53:11.338Z' } });
  const rows = [legacy(1), legacy(2), legacy(3), legacy(4)];
  const backup = { data: { auditlogs: rows } };
  const plan = [{ name: 'auditlogs', docs: rows.length, existing: 0, overlapping: 0, added: rows.length, model: AuditLog }];
  const logs = [];
  const result = await applyRestore({ backup, plan, db, replace: false, log: (line, level) => logs.push([level, line]) });

  assert.equal(result.failed, 0, JSON.stringify(logs));
  assert.equal(await db.collection('auditlogs').countDocuments(), 4, 'all four came back, not just the first');
  assert.equal(await db.collection('auditlogs').countDocuments({ chainSequence: { $exists: true } }), 0, 'and none was given a chain number it never had');
  // Idempotent: restoring again replaces, it does not duplicate or fail.
  const again = await applyRestore({ backup, plan, db, replace: false, log: () => {} });
  assert.equal(again.failed, 0);
  assert.equal(await db.collection('auditlogs').countDocuments(), 4);
});

// The same rule one level down: the model also adds defaults INSIDE an object the document does have (a nested
// `lastFailedAt: null`), and a restore must not invent those either (the restored copy of the real backup gained one).
test('a nested object keeps exactly the fields the file had, and a value that is there is still cast', { skip }, async () => {
  const { applyRestore } = require('../../src/utils/restore');
  const User = require('../../src/models/User');
  const db = mongoose.connection.db;
  await db.collection('users').deleteMany({});
  const _id = new mongoose.Types.ObjectId().toString();
  const row = { _id, name: 'Nested Check', email: 'nested@example.test', password: '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234', role: 'admin', twoFactor: { enabled: true, enrolledAt: { $date: '2026-10-01T00:00:00.000Z' } }, createdAt: { $date: '2026-09-18T06:53:11.338Z' } };
  const plan = [{ name: 'users', docs: 1, existing: 0, overlapping: 0, added: 1, model: User }];
  const result = await applyRestore({ backup: { data: { users: [row] } }, plan, db, replace: false, log: () => {} });
  assert.equal(result.failed, 0);
  const stored = await db.collection('users').findOne({});
  assert.deepEqual(Object.keys(stored.twoFactor).sort(), ['enabled', 'enrolledAt'], 'no defaults invented inside the nested object');
  assert.ok(stored.twoFactor.enrolledAt instanceof Date, 'a value that is there is still cast to what it was');
  assert.ok(stored._id instanceof mongoose.Types.ObjectId, 'and so is the id');
  await db.collection('users').deleteMany({});
});
