// The audit trail, made tamper-evident.
//
// The trail already answers "who changed what, and when". What it could not answer is
// the question that matters when it is read in anger: "is this all of it?" Every entry
// is a MongoDB document, and anyone who can edit a document can edit an entry — or
// delete one — and leave a trail that reads perfectly while being false. The collection
// is append-only by convention (nothing in the API deletes from it), but a convention is
// not a control, and the person most motivated to break it is exactly the person the
// trail exists to watch.
//
// So each entry carries the hash of the entry before it. Change any field of any entry,
// drop one, or insert one, and every hash after that point stops matching: the trail
// cannot be quietly rewritten, only visibly broken. `npm run verify:audit` walks the
// chain and names the first entry that does not add up.
//
// What this is not: it is not a signature, and it is not proof against somebody who
// rewrites *every* entry from the break onward and recomputes the hashes. That requires
// the chain to be anchored somewhere the operator cannot reach — a printed monthly hash,
// an emailed copy, or a backup kept off-site. This module gives that anchor something to
// be: `chainHead` is the value to write down and compare later, and the README says to.
const crypto = require('crypto');

// The hash a first entry chains from. Sixty-four zeros keeps the field the same shape
// for every entry including the first, so the verifier needs no special case and a null
// can never be mistaken for "the chain is fine".
const GENESIS_HASH = '0'.repeat(64);

const CHAIN_FIELDS = ['action', 'entityType', 'entityId', 'performedBy', 'before', 'after', 'createdAt'];

// A canonical form to hash, because `JSON.stringify` over the same logical value does
// not always produce the same string: key order follows insertion order, so two
// documents that mean the same thing can serialise differently — and a verifier that
// re-serialises a stored document would then report a break that is not there. Sorting
// keys and pinning dates to ISO removes that whole class of false alarm.
function canonicalize(value) {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString('base64'));
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// The exact bytes that are hashed: the previous hash and the entry's own content. The
// separator is there so a previous hash ending in a digit cannot be confused with an
// entry that begins with one — without it, two different (prev, entry) pairs could
// concatenate to the same string.
function entryPayload(prevHash, entry) {
  const body = {};
  for (const field of CHAIN_FIELDS) body[field] = entry[field];
  return `${prevHash}:${canonicalize(body)}`;
}

function chainHash(prevHash, entry) {
  return crypto.createHash('sha256').update(entryPayload(prevHash, entry)).digest('hex');
}


// Recomputes the chain over entries already in sequence order and returns the first
// inconsistency, or `{ ok: true, verified }`.
//
// Only entries carrying a `chainSequence` are checked — the trail predates this module,
// and calling those older entries tampered with would be a lie. The caller may pass the
// expected head to prove the trail has not been truncated from the end, which is the one
// attack a chain alone cannot catch.
function verifyChain(entries, { expectedHead = null } = {}) {
  const chained = entries
    .filter((entry) => entry && entry.chainSequence != null)
    .sort((a, b) => a.chainSequence - b.chainSequence);

  if (chained.length === 0) {
    return { ok: true, verified: 0, note: 'No chained entries yet.' };
  }

  let prevHash = chained[0].prevHash;
  let expectedSequence = chained[0].chainSequence;

  for (const entry of chained) {
    if (entry.chainSequence !== expectedSequence) {
      return {
        ok: false,
        reason: 'gap',
        id: String(entry._id),
        chainSequence: entry.chainSequence,
        expectedSequence,
        message: `Entry ${entry.chainSequence} follows ${expectedSequence - 1} — an entry is missing from the chain.`,
      };
    }
    if (entry.prevHash !== prevHash) {
      return {
        ok: false,
        reason: 'link',
        id: String(entry._id),
        chainSequence: entry.chainSequence,
        message: `Entry ${entry.chainSequence} does not point at the entry before it — an entry was inserted, removed or reordered.`,
      };
    }
    const recomputed = chainHash(entry.prevHash, entry);
    if (recomputed !== entry.hash) {
      return {
        ok: false,
        reason: 'content',
        id: String(entry._id),
        chainSequence: entry.chainSequence,
        message: `Entry ${entry.chainSequence} has been altered since it was written — its contents no longer hash to the value stored with it.`,
      };
    }
    prevHash = entry.hash;
    expectedSequence += 1;
  }

  const head = prevHash;
  if (expectedHead && expectedHead !== head) {
    return {
      ok: false,
      reason: 'head',
      head,
      expectedHead,
      message: 'The trail is internally consistent but does not end where the recorded head says it should — entries were removed from the end.',
    };
  }

  return { ok: true, verified: chained.length, head, firstSequence: chained[0].chainSequence };
}

// The entry as it will be stored, with its chain fields filled in. Kept separate from the
// write so the hash is a pure function of (previous hash, content) and can be tested
// without a database.
//
// `createdAt` is passed in rather than left to mongoose, because it is part of what is
// hashed: the verifier recomputes from the stored document, so the value must be decided
// before the hash is taken, not assigned by the driver afterwards.
function chainedEntry({ previous, entry, createdAt = new Date() }) {
  const prevHash = previous?.hash || GENESIS_HASH;
  const chainSequence = previous?.chainSequence != null ? previous.chainSequence + 1 : 1;
  const complete = { ...entry, createdAt };
  return { ...complete, prevHash, chainSequence, hash: chainHash(prevHash, complete) };
}

module.exports = {
  GENESIS_HASH,
  CHAIN_FIELDS,
  canonicalize,
  entryPayload,
  chainHash,
  verifyChain,
  chainedEntry,
};
