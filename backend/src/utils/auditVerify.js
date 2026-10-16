// Walking the stored audit chain, batch by batch.
//
// Shared by the command line (`npm run verify:audit`) and the super admin's oversight
// screen, so both give the same answer from the same code. It reads and never writes.
//
// Paged by sequence rather than skipped — the collection only grows, and a skip over a
// million documents is a scan for every page — and each batch is checked against the last
// entry of the one before it, so a break that falls exactly on a batch boundary is still a
// break.
const AuditLog = require('../models/AuditLog');
const { verifyChain } = require('./auditChain');

const BATCH = 2000;

async function verifyStoredTrail({ since = null, onProgress = null } = {}) {
  const baseFilter = { chainSequence: { $ne: null } };
  if (since) baseFilter.createdAt = { $gte: since };

  const [total, unchained] = await Promise.all([
    AuditLog.countDocuments(baseFilter),
    AuditLog.countDocuments({ chainSequence: null }),
  ]);
  if (total === 0) return { ok: true, checked: 0, total, unchained, head: null, firstSequence: null };

  let cursor = null;
  let last = null;
  let checked = 0;
  let firstSequence = null;

  for (;;) {
    const query = { ...baseFilter };
    if (cursor !== null) query.chainSequence = { $ne: null, $gt: cursor };
    const batch = await AuditLog.find(query)
      .sort({ chainSequence: 1 })
      .limit(BATCH)
      .select('_id action entityType entityId performedBy before after createdAt prevHash hash chainSequence')
      .lean();
    if (batch.length === 0) break;

    // A `since` window starts mid-chain, so only a batch that follows another can be
    // checked against it; the first one is anchored on its own recorded prevHash.
    const result = verifyChain(batch, { continueFrom: last });
    if (!result.ok) return { ok: false, checked, total, unchained, broken: result };

    checked += batch.length;
    if (firstSequence === null) firstSequence = result.firstSequence;
    last = batch[batch.length - 1];
    cursor = last.chainSequence;
    if (onProgress) onProgress(checked, total);
    if (batch.length < BATCH) break;
  }

  return { ok: true, checked, total, unchained, head: last ? last.hash : null, firstSequence };
}

module.exports = { verifyStoredTrail, BATCH };
