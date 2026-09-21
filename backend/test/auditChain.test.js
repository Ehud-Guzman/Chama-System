// The audit chain, and what it can actually catch.
//
// The value of this module is entirely in the failures it detects, so most of the tests
// below are tampering: an edited field, a deleted entry, a reordered pair, a truncated
// tail. A chain that only passes when nothing is wrong has not been tested.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GENESIS_HASH,
  canonicalize,
  chainHash,
  verifyChain,
  chainedEntry,
} = require('../src/utils/auditChain');

// Builds a chain the way the logger does: each entry from the one before it.
function buildChain(entries) {
  const chained = [];
  let previous = null;
  for (const entry of entries) {
    const next = chainedEntry({ previous, entry, createdAt: new Date('2026-01-02T10:00:00.000Z') });
    chained.push(next);
    previous = next;
  }
  return chained;
}

const SAMPLE = [
  { action: 'create', entityType: 'Member', entityId: 'aaa', performedBy: 'user1', before: null, after: { name: 'Example Member', openingBalance: 1000 } },
  { action: 'update', entityType: 'Member', entityId: 'aaa', performedBy: 'user1', before: { openingBalance: 1000 }, after: { openingBalance: 2500 } },
  { action: 'create', entityType: 'Contribution', entityId: 'bbb', performedBy: 'user2', before: null, after: { amount: 1400, date: new Date('2026-01-02T00:00:00.000Z') } },
];

test('canonicalisation does not depend on key order', () => {
  // This is the property the whole verifier rests on: a stored document comes back with
  // its keys in whatever order the driver returns them, and re-serialising must produce
  // the same bytes as when it was hashed.
  assert.equal(canonicalize({ a: 1, b: 2 }), canonicalize({ b: 2, a: 1 }));
  assert.equal(canonicalize({ a: { x: 1, y: 2 } }), canonicalize({ a: { y: 2, x: 1 } }));
  // But a different value is a different string.
  assert.notEqual(canonicalize({ a: 1 }), canonicalize({ a: '1' }));
  // Dates are pinned, so a Date and its ISO string agree.
  assert.equal(canonicalize(new Date('2026-01-02T00:00:00.000Z')), canonicalize('2026-01-02T00:00:00.000Z'));
  assert.equal(canonicalize(null), 'null');
  assert.equal(canonicalize([1, null, 'a']), '[1,null,"a"]');
});

test('the first entry chains from genesis, and each one follows the last', () => {
  const chain = buildChain(SAMPLE);
  assert.equal(chain[0].prevHash, GENESIS_HASH);
  assert.equal(chain[0].chainSequence, 1);
  assert.equal(chain[1].prevHash, chain[0].hash);
  assert.equal(chain[1].chainSequence, 2);
  assert.equal(chain[2].prevHash, chain[1].hash);
  assert.equal(chain[2].chainSequence, 3);
  for (const entry of chain) {
    assert.match(entry.hash, /^[0-9a-f]{64}$/);
  }
});

test('an untouched chain verifies, and reports its head', () => {
  const chain = buildChain(SAMPLE);
  const result = verifyChain(chain);
  assert.equal(result.ok, true);
  assert.equal(result.verified, 3);
  assert.equal(result.head, chain[2].hash);
});

test('the same content always hashes the same, and a change always shows', () => {
  const chain = buildChain(SAMPLE);
  // Rebuilding from the same inputs gives the same hashes — no clock, no salt, no
  // randomness in the hash itself.
  assert.equal(buildChain(SAMPLE)[2].hash, chain[2].hash);
  // One field in one entry, changed by one shilling.
  const edited = { ...chain[1], after: { openingBalance: 2501 } };
  assert.notEqual(chainHash(edited.prevHash, edited), chain[1].hash);
});

test('an edited entry is caught, and named', () => {
  const chain = buildChain(SAMPLE);
  chain[1].after = { openingBalance: 2501 };
  const result = verifyChain(chain);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'content');
  assert.equal(result.chainSequence, 2);
  assert.match(result.message, /altered/);
});

test('a deleted entry is caught as a gap', () => {
  const chain = buildChain(SAMPLE);
  const result = verifyChain([chain[0], chain[2]]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'gap');
  assert.equal(result.chainSequence, 3);
  assert.equal(result.expectedSequence, 2);
});

test('a reordered pair is caught as a broken link', () => {
  const chain = buildChain(SAMPLE);
  const result = verifyChain([
    chain[0],
    { ...chain[2], chainSequence: 2 },
    { ...chain[1], chainSequence: 3 },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'link');
});

test('an inserted entry is caught even when it is a validly hashed one', () => {
  const chain = buildChain(SAMPLE);
  // A forger who understands the format can hash a new entry correctly. What he cannot
  // do is make it fit, because the entry after it already points somewhere else.
  const forged = chainedEntry({
    previous: chain[1],
    entry: {
      action: 'delete',
      entityType: 'Member',
      entityId: 'ccc',
      performedBy: 'user9',
      before: null,
      after: null,
    },
  });
  const result = verifyChain([chain[0], chain[1], forged, { ...chain[2], chainSequence: 4 }]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'link');
});

test('removing entries from the end is caught by the recorded head', () => {
  const chain = buildChain(SAMPLE);
  const head = chain[2].hash;
  // Truncation is the one thing a chain cannot see by itself — the shortened trail is
  // internally perfect. The head recorded elsewhere is what catches it.
  assert.equal(verifyChain([chain[0], chain[1]]).ok, true);
  const result = verifyChain([chain[0], chain[1]], { expectedHead: head });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'head');
});

test('entries from before the chain existed are left alone', () => {
  // The trail predates this module. Calling those entries tampered with would be a lie,
  // so they are outside the chain: unhashed, unordered, and skipped.
  const legacy = [
    { _id: 'legacy1', action: 'create', entityType: 'Member', entityId: 'old', performedBy: 'user1' },
    { _id: 'legacy2', action: 'update', entityType: 'Member', entityId: 'old', performedBy: 'user1' },
  ];
  const result = verifyChain([...legacy, ...buildChain(SAMPLE)]);
  assert.equal(result.ok, true);
  assert.equal(result.verified, 3);
});

test('an empty or unchained trail verifies with nothing checked', () => {
  assert.equal(verifyChain([]).verified, 0);
  assert.equal(verifyChain([{ _id: 'x', action: 'create' }]).verified, 0);
});

test('the verifier sorts by sequence, so call order does not matter', () => {
  const chain = buildChain(SAMPLE);
  // The read path pages newest-first off an index; the verifier must not care.
  assert.equal(verifyChain([...chain].reverse()).ok, true);
});
