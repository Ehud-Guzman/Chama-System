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
const { ObjectId } = require('mongoose').Types;

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

// An id nested in `before` or `after` was an id when the entry was hashed. A backup written before ids carried a
// marker (`{$oid}`) turned it into hex text on the way out, and nothing in the file says which texts were ids:
// the same snapshot can hold `memberId` as text (it went through JSON first) and another field as an id. So a
// restored entry is tried again with each combination of its 24-hex texts turned back into ids. It passes ONLY
// if the stored hash is reproduced exactly, so nothing that was changed is excused.
const HEX_ID = /^[0-9a-f]{24}$/i;
const MAX_HEX_TEXTS = 12; // 4,095 combinations at most; an entry with more is left to fail rather than hang a check

function isPlainObject(value) {
  return value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value) && value.constructor === Object;
}

function countHexTexts(value) {
  if (Array.isArray(value)) return value.reduce((n, item) => n + countHexTexts(item), 0);
  if (typeof value === 'string') return HEX_ID.test(value) ? 1 : 0;
  if (isPlainObject(value)) return Object.values(value).reduce((n, item) => n + countHexTexts(item), 0);
  return 0;
}

// `value` with the hex texts whose position (in walking order) has its bit set in `mask` turned into ids.
function applyHexMask(value, mask, state) {
  if (Array.isArray(value)) return value.map((item) => applyHexMask(item, mask, state));
  if (typeof value === 'string' && HEX_ID.test(value)) {
    const turn = (mask >> state.i) & 1;
    state.i += 1;
    return turn ? new ObjectId(value) : value;
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = applyHexMask(inner, mask, state);
    return out;
  }
  return value;
}

function* hexIdVariants(entry) {
  const count = countHexTexts(entry.before) + countHexTexts(entry.after);
  if (count === 0 || count > MAX_HEX_TEXTS) return;
  for (let mask = 1; mask < 2 ** count; mask += 1) {
    const state = { i: 0 };
    const before = applyHexMask(entry.before, mask, state);
    const after = applyHexMask(entry.after, mask, state);
    yield { ...entry, before, after };
  }
}

// Whether `entry` hashes to its stored hash, exactly or as an entry restored from a backup that did not keep ids as ids.
function matchesStoredHash(entry) {
  if (chainHash(entry.prevHash, entry) === entry.hash) return { ok: true, legacy: false };
  for (const variant of hexIdVariants(entry)) {
    if (chainHash(entry.prevHash, variant) === entry.hash) return { ok: true, legacy: true };
  }
  return { ok: false, legacy: false };
}


// Recomputes the chain over entries already in sequence order and returns the first
// inconsistency, or `{ ok: true, verified }`.
//
// Only entries carrying a `chainSequence` are checked — the trail predates this module,
// and calling those older entries tampered with would be a lie. The caller may pass the
// expected head to prove the trail has not been truncated from the end, which is the one
// attack a chain alone cannot catch.
//
// `continueFrom` ({ hash, chainSequence }) is the last entry of the batch before this one.
// A trail read in batches must carry it across the join: without it each batch trusts its
// own first `prevHash`, and an entry swapped exactly on a batch boundary would pass.
function verifyChain(entries, { expectedHead = null, continueFrom = null } = {}) {
  const chained = entries
    .filter((entry) => entry && entry.chainSequence != null)
    .sort((a, b) => a.chainSequence - b.chainSequence);

  if (chained.length === 0) {
    return { ok: true, verified: 0, note: 'No chained entries yet.' };
  }

  let prevHash = continueFrom ? continueFrom.hash : chained[0].prevHash;
  let expectedSequence = continueFrom ? continueFrom.chainSequence + 1 : chained[0].chainSequence;

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
    if (!matchesStoredHash(entry).ok) {
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
  matchesStoredHash,
  verifyChain,
  chainedEntry,
};
