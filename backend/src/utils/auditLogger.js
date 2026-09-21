const AuditLog = require('../models/AuditLog');
const { chainedEntry } = require('./auditChain');
const { logEvent } = require('../middleware/requestLogger');

// How many times a writer will re-read the head and try again when two entries race for
// the same place in the chain. Losing the race means being overtaken between reading the
// head and inserting, and each retry re-reads a head that has moved on — so a handful of
// attempts covers a burst, and failing all of them is worth knowing about.
const CHAIN_RETRIES = 5;

// The newest chained entry, which is what the next entry hashes against.
async function chainHead() {
  return AuditLog.findOne({ chainSequence: { $ne: null } })
    .sort({ chainSequence: -1 })
    .select('hash chainSequence')
    .lean();
}

// Writes an audit entry for every create/update/delete on a record.
// before/after are full document snapshots (null on create/delete respectively).
//
// The write is chained: each entry carries the hash of the one before it, so the trail
// cannot be edited, trimmed or added to without the break being visible
// (utils/auditChain, and `npm run verify:audit`). The chain is deliberately *not* a
// reason to fail the operation being audited — an audit write failure is logged and the
// caller carries on, because refusing a member's payment because the trail could not be
// written would be the tail wagging the dog. What the caller gets back is the entry, or
// null, and every route that matters already ignores it.
async function logAudit({ action, entityType, entityId, performedBy, before = null, after = null }) {
  const entry = { action, entityType, entityId, performedBy, before, after };

  for (let attempt = 0; attempt < CHAIN_RETRIES; attempt += 1) {
    try {
      const previous = await chainHead();
      const document = chainedEntry({ previous, entry });
      const created = await AuditLog.create(document);
      return created;
    } catch (err) {
      // 11000 is a duplicate key. With `chainSequence` unique and sparse, that means
      // somebody else took this place while the head was being read — so re-read it and
      // try again rather than writing an unchained entry.
      if (err?.code === 11000) continue;

      // Anything else is a real failure: the database is down, the schema rejected the
      // document, or the payload is not serialisable.
      console.error(`Audit log write failed (${action} ${entityType} ${entityId}):`, err.message);
      return null;
    }
  }

  // Lost the race five times running. The books are unaffected — the entry is missing,
  // not wrong — and this line is how that becomes visible.
  logEvent(
    'audit_chain_contention',
    { action, entityType: String(entityId), attempts: CHAIN_RETRIES },
    'error'
  );
  return null;
}

// Plain-object snapshot of a mongoose doc, safe to store in a Mixed field.
function snapshot(doc) {
  return doc ? JSON.parse(JSON.stringify(doc.toObject ? doc.toObject() : doc)) : null;
}

module.exports = { logAudit, snapshot, chainHead };
