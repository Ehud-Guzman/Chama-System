const Fine = require('../models/Fine');
require('../models/FineType'); // the populate below resolves a ref by name
const { getOrCreateSettings } = require('./settings');
const {
  isMailConfigured,
  sendMail,
  describeMailError,
  buildFineIssuedEmail,
  buildFineSettledEmail,
} = require('./mailer');
const { logAudit } = require('./auditLogger');
const { logEvent } = require('../middleware/requestLogger');

// The two emails a fine produces, in one place.
//
// A fine is issued, or a fine is paid — and until now the member found out by being
// told at a meeting, or did not find out at all. Both messages are automatic, off the
// same records the fines screen shows, and neither can hold up the entry that caused
// it: the fine is written and audited first, and this module is the last thing the
// request does. It never throws. A mail server that is down or badly configured must
// not be able to leave the office unable to record a fine.
//
// The switch is FINE_EMAILS, and it is ON by default, unlike the weekly reminder sweep
// (REMINDER_SWEEP_SEND, which is off): a sweep emails the whole membership on its own,
// while these two are triggered by a person deliberately recording or settling a fine
// on one member's record. Set FINE_EMAILS=off on a deployment whose committee does not
// want them. A member with no address, or who has switched emails off (Member
// .emailNotifications), is skipped and the reason goes to the request log.

const OFF_VALUES = new Set(['off', 'false', 'no', '0', 'disabled']);

function fineEmailsEnabled() {
  const raw = String(process.env.FINE_EMAILS ?? '').trim().toLowerCase();
  if (!raw) return true;
  return !OFF_VALUES.has(raw);
}

// Why this member cannot be emailed, or null when he can. Pure — no database, no
// connection — so the test can ask the question without either.
function fineEmailSkipReason(member) {
  if (!fineEmailsEnabled()) return 'Fine emails are switched off (FINE_EMAILS=off)';
  if (!member) return 'Member not found';
  if (!String(member.email || '').trim()) return 'No email address on file';
  if (member.emailNotifications === false) return 'Member has switched email notifications off';
  if (!isMailConfigured()) return 'Email sending is not set up on this deployment';
  return null;
}

// One send, with everything that can go wrong caught. Returns { sent, reason } so a
// caller or a test can see what happened; nothing is ever thrown at the caller.
async function deliver({ member, build, kind, performedBy = null, rid = null, details = {} }) {
  const skip = fineEmailSkipReason(member);
  if (skip) {
    logEvent('fine_email_skipped', {
      rid,
      kind,
      memberId: member ? String(member._id) : null,
      reason: skip,
    });
    return { sent: false, reason: skip };
  }

  try {
    const settings = await getOrCreateSettings();
    const { subject, html, text } = build(settings.chamaName);
    await sendMail({ to: member.email, subject, html, text });

    // Written down as it happens: the response this belongs to may never be read, and
    // "were the fine emails sent?" otherwise has no answer on the server.
    logEvent('fine_email_sent', { rid, kind, memberId: String(member._id), subject });
    await logAudit({
      action: 'create',
      entityType: 'Notification',
      entityId: member._id,
      performedBy,
      after: { channel: 'email', kind, to: member.email, subject, ...details },
    });
    return { sent: true, reason: null };
  } catch (err) {
    // The provider's own words: 535 for a revoked key, 550 for an address it will not
    // accept, ETIMEDOUT for a port the host has closed. Each is a different fix, and
    // none of them is guessable from a screen that only says the send did not finish.
    logEvent(
      'fine_email_failed',
      { rid, kind, memberId: String(member._id), error: describeMailError(err) },
      'error'
    );
    return { sent: false, reason: describeMailError(err) };
  }
}

// A fine has just been issued. `fine` is the document as it was just written; its
// typeId may or may not be populated — either shape reads correctly.
async function announceFineIssued({ fine, member, performedBy, rid = null }) {
  if (!fine || !member) return { sent: false, reason: 'Nothing to send' };

  return deliver({
    member,
    kind: 'fine_issued',
    performedBy,
    rid,
    details: {
      fineId: String(fine._id),
      amount: Number(fine.amount) || 0,
      remaining: Number(fine.remaining) || 0,
    },
    build: (chamaName) =>
      buildFineIssuedEmail({
        chamaName,
        member,
        fine: {
          typeName: fine.typeId?.name || 'Fine',
          reason: fine.reason || '',
          amount: fine.amount,
          remaining: fine.remaining,
          date: fine.date,
        },
      }),
  });
}

// One payment against one or more fines. `payments` is [{ label, amount, remaining }],
// where `remaining` is what is still owed on that fine after this payment — the member
// is told both what cleared and what is left, because a payment that neither clears nor
// is acknowledged is the one that gets paid twice.
async function announceFinesPaid({
  payments,
  member,
  totalPaid,
  paidAt = new Date(),
  note = '',
  performedBy,
  rid = null,
}) {
  const lines = (payments || []).filter((p) => Number(p.amount) > 0);
  if (!member || lines.length === 0) return { sent: false, reason: 'Nothing to send' };

  const total = Number(totalPaid) || lines.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  return deliver({
    member,
    kind: 'fine_paid',
    performedBy,
    rid,
    details: {
      totalPaid: total,
      fines: lines.map((p) => ({ label: p.label || 'Fine', amount: Number(p.amount) || 0 })),
    },
    build: (chamaName) =>
      buildFineSettledEmail({ chamaName, member, payments: lines, totalPaid: total, paidAt, note }),
  });
}

// The payment lines for a set of fineSettlements allocations (utils/fineAllocation):
// the reason is what the office wrote on the fine and is what the member will
// recognise; the fine type is the fallback when no reason was given. Read back from the
// database so `remaining` is what the fine holds after the settlement, not a guess.
async function paymentsFromAllocations(allocations) {
  const list = allocations || [];
  if (list.length === 0) return [];

  const fines = await Fine.find({ _id: { $in: list.map((a) => a.fine._id) } })
    .populate('typeId', 'name')
    .lean();
  const byId = new Map(fines.map((f) => [String(f._id), f]));

  return list.map(({ fine, applied }) => {
    const fresh = byId.get(String(fine._id));
    return {
      label: fresh?.reason || fresh?.typeId?.name || 'Fine',
      amount: Number(applied) || 0,
      remaining: Number(fresh?.remaining ?? Math.max(Number(fine.remaining) - applied, 0)) || 0,
    };
  });
}

module.exports = {
  fineEmailsEnabled,
  fineEmailSkipReason,
  announceFineIssued,
  announceFinesPaid,
  paymentsFromAllocations,
};


