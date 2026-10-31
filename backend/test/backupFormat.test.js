// The backup's encoding.
//
// This exists because the encoding was silently wrong: the walk that turns a document
// into JSON used `Object.entries`, and a Date has no own enumerable properties — so every
// date in every backup became `{}`. A backup is only ever read when something has already
// gone wrong, which is the worst possible moment to discover that the dates in it are
// gone. The restore round trip (test/integration/ledger.test.js) covers the whole path
// against a real database; these are the rules, fast.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { encodeForBackup } = require('../src/controllers/backupController');
const { reviveBuffers } = require('../src/utils/restore');

test('a date survives as a date, not as an empty object', () => {
  const when = new Date('2026-09-18T06:30:00.000Z');
  assert.deepEqual(encodeForBackup(when, false), { $date: '2026-09-18T06:30:00.000Z' });
  // The bug, spelled out: walking it would have produced this.
  assert.deepEqual({ ...when }, {});
});

test('an id is written as an id, so a free-form field gets it back as one', () => {
  const id = new mongoose.Types.ObjectId();
  assert.deepEqual(encodeForBackup(id, false), { $oid: String(id) });
  // The round trip the audit trail depends on: an id nested in an audit entry's `after` has no schema to cast it
  // back, so the file has to say what it is.
  const entry = { after: { id, members: [id] }, createdAt: new Date('2026-10-17T11:34:21.820Z') };
  const back = reviveBuffers(JSON.parse(JSON.stringify(encodeForBackup(entry, false))));
  assert.ok(back.after.id instanceof mongoose.Types.ObjectId);
  assert.ok(back.after.members[0] instanceof mongoose.Types.ObjectId);
  assert.equal(String(back.after.id), String(id));
  assert.ok(back.createdAt instanceof Date);
  // A file written before ids carried a marker still reads: a bare hex string is left for the model to cast.
  assert.equal(reviveBuffers({ id: String(id) }).id, String(id));
});

test('document bytes become base64, or nothing at all in a slim copy', () => {
  const bytes = Buffer.from('a scanned title deed');
  assert.deepEqual(encodeForBackup(bytes, false), {
    $binary: bytes.toString('base64'),
  });
  assert.equal(encodeForBackup(bytes, true), null);
});

test('a whole document is walked, with its dates and its ids', () => {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Member One',
    openingBalance: 106700,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    settlements: [
      { contributionId: new mongoose.Types.ObjectId(), amount: 500, date: new Date('2026-02-01T00:00:00.000Z') },
    ],
    attachments: [{ data: Buffer.from('x'), fileName: 'deed.pdf' }],
  };

  const encoded = encodeForBackup(doc, false);
  assert.equal(encoded.name, 'Member One');
  assert.equal(encoded.openingBalance, 106700);
  assert.deepEqual(encoded.createdAt, { $date: '2026-01-02T00:00:00.000Z' });
  assert.deepEqual(encoded.settlements[0].date, { $date: '2026-02-01T00:00:00.000Z' });
  assert.deepEqual(encoded.settlements[0].contributionId, { $oid: String(doc.settlements[0].contributionId) });
  // The only thing JSON.stringify must not be left to do on its own: bytes.
  assert.equal(encoded.attachments[0].data.$binary, Buffer.from('x').toString('base64'));
  assert.equal(encoded.attachments[0].fileName, 'deed.pdf');
});

test('a slim copy keeps the shape but drops the bytes', () => {
  const encoded = encodeForBackup(
    { _id: new mongoose.Types.ObjectId(), data: Buffer.from('big scan'), fileName: 'deed.pdf' },
    true
  );
  assert.equal(encoded.data, null);
  assert.equal(encoded.fileName, 'deed.pdf');
});

test('nothing else is disturbed', () => {
  assert.equal(encodeForBackup(null, false), null);
  assert.equal(encodeForBackup(undefined, false), undefined);
  assert.equal(encodeForBackup('text', false), 'text');
  assert.equal(encodeForBackup(1400, false), 1400);
  assert.deepEqual(encodeForBackup([1, 'two', false], false), [1, 'two', false]);
});
