// The scheduled audit check — and, with it, the anchor that makes the chain worth having.
//
// utils/auditChain makes the trail detectably wrong if anybody edits it. Two things were still
// missing, and both are this job:
//
//   1. **Somebody has to look.** A chain that nobody verifies proves nothing; it is a lock
//      nobody tries. The whole trail is walked on a schedule and the answer is recorded, so a
//      break is discovered in a week rather than at the next argument.
//
//   2. **The head has to leave the database.** The chain cannot detect entries removed from the
//      *end* — a shortened trail is internally perfect — and a head stored in the same database
//      as the trail it protects can be rewritten by whoever rewrote the trail. So the head is
//      emailed to the committee when mail is configured, and written to the job record either
//      way. The value received a month ago is what proves nothing was dropped since.
//
// It also trims the trail, because retention is the other half of an append-only collection:
// the snapshots contain whole member records, and "we keep everything forever" is a decision
// nobody made. `AUDIT_RETENTION_DAYS` defaults to 0, which means keep everything — quietly
// deleting the group's history is worse than keeping it.
const AuditLog = require('../models/AuditLog');
const { verifyChain } = require('../utils/auditChain');
const { isMailConfigured, sendMail } = require('../utils/mailer');
const { logEvent } = require('../middleware/requestLogger');

const BATCH = 2000;

function retentionDays() {
  const configured = Number(process.env.AUDIT_RETENTION_DAYS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 0;
}

// Walks the chained segment in pages, oldest first, and stops at the first break.
//
// Paged by sequence rather than skipped: the collection only grows, and a `skip` over a
// million documents is a full scan for every page.
async function walkChain() {
  const filter = { chainSequence: { $ne: null } };
  const total = await AuditLog.countDocuments(filter);
  let cursor = null;
  let checked = 0;
  let head = null;
  let firstSequence = null;

  while (true) {
    const query = cursor === null ? filter : { chainSequence: { $ne: null, $gt: cursor } };
    const batch = await AuditLog.find(query)
      .sort({ chainSequence: 1 })
      .limit(BATCH)
      .select('_id action entityType entityId performedBy before after createdAt prevHash hash chainSequence')
      .lean();

    if (batch.length === 0) break;

    const result = verifyChain(batch);
    if (!result.ok) return { ok: false, total, checked, break: result };

    checked += batch.length;
    head = result.head;
    if (firstSequence === null) firstSequence = result.firstSequence;
    cursor = batch[batch.length - 1].chainSequence;
    if (batch.length < BATCH) break;
  }

  return { ok: true, total, checked, head, firstSequence };
}

// Removes entries older than the retention window — but only unchained ones.
//
// Deleting from the middle of a chain would leave a gap the verifier reports forever, so this
// only ever prunes the history that predates the chain. Shortening a chained trail honestly
// means deleting a prefix and accepting that the chain restarts, which is a decision for a
// person, not for a nightly job.
async function pruneOldEntries(days) {
  if (!days) return { deleted: 0, skipped: 'retention not set' };

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await AuditLog.deleteMany({ createdAt: { $lt: cutoff }, chainSequence: null });
  return { deleted: result.deletedCount, cutoff };
}

async function runAuditJob({ trigger = 'schedule', notify = true } = {}) {
  const check = await walkChain();
  const retention = retentionDays();
  const pruned = await pruneOldEntries(retention);

  const summary = {
    ok: check.ok,
    chainedEntries: check.total,
    checked: check.checked,
    head: check.head || null,
    firstSequence: check.firstSequence ?? null,
    pruned,
    retentionDays: retention,
  };

  if (!check.ok) {
    // Loud in every channel available: the log, the job record (which the settings screen
    // shows) and email. A tampered trail is not something to discover by noticing a number.
    logEvent(
      'audit_chain_broken',
      { reason: check.break.reason, entry: check.break.id, sequence: check.break.chainSequence },
      'error'
    );
    summary.break = {
      reason: check.break.reason,
      entry: check.break.id,
      sequence: check.break.chainSequence,
      message: check.break.message,
    };
  }

  // The head, sent somewhere the database's owner cannot quietly edit. This is the whole
  // reason the job emails at all.
  if (notify && isMailConfigured()) {
    try {
      const to = process.env.AUDIT_HEAD_EMAIL || process.env.MAIL_REPLY_TO || process.env.MAIL_FROM;
      const broken = !check.ok;
      const subject = broken
        ? 'AUDIT TRAIL CHECK FAILED — Chama system'
        : `Audit trail check: OK (${check.checked} entries)`;
      const lines = broken
        ? [
            'The audit trail did not verify.',
            '',
            check.break.message,
            `Entry:    ${check.break.id}`,
            `Sequence: ${check.break.chainSequence}`,
            '',
            'Do not touch the database. Compare the trail against the most recent backup, and',
            'tell the committee — the entries that are still good are evidence.',
          ]
        : [
            'The audit trail verified: every entry still hashes to the value stored with it.',
            '',
            `Entries checked: ${check.checked}`,
            `First chained:   ${check.firstSequence}`,
            `Chain head:      ${check.head}`,
            '',
            'Keep this message. Comparing next time proves that nothing was removed from the end',
            'of the trail — the one thing the chain cannot check by itself.',
          ];
      await sendMail({ to, subject, text: lines.join('\n'), html: `<pre>${lines.join('\n')}</pre>` });
      summary.headEmailed = to;
    } catch (err) {
      // Mail failing must not fail the check: the answer is in the job record either way.
      summary.headEmailError = err.message;
    }
  }

  return summary;
}

module.exports = { runAuditJob, walkChain, pruneOldEntries, retentionDays };
