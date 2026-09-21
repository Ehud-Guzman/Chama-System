// The weekly reminder sweep.
//
// The reminders screen has always been able to email members who are behind — but only when
// somebody opens it, selects names and presses send, which means it happens in the weeks
// somebody remembers. This job is the same message, off the same figures, sent without anybody
// remembering.
//
// **It computes every week and sends only when told to.** That split is deliberate and is the
// same principle as `autoSettleFines` being off by default: a deploy must never begin emailing
// the membership on its own. The weekly part of the job is the *report* — who is behind, by how
// much — which the committee can read on the settings screen; the sending is switched on
// separately with `REMINDER_SWEEP_SEND=true`, by the people whose names go on the message.
//
// The dues come from the same cycle engine the member's own page uses (computeMemberLedger via
// notificationController.computeMemberDues), so a member can never be emailed a week number or
// an amount his own passbook contradicts.
const Member = require('../models/Member');
const { getOrCreateSettings } = require('../utils/settings');
const { isMailConfigured } = require('../utils/mailer');
const { computeBackupHealth } = require('../utils/backupHealth');
const {
  computeMemberDues,
  deliverReminders,
} = require('../controllers/notificationController');
const { resolveSystemActor } = require('../utils/systemActor');
const { logEvent } = require('../middleware/requestLogger');

function sendsEnabled() {
  return String(process.env.REMINDER_SWEEP_SEND || '').toLowerCase() === 'true';
}

function maxRecipients() {
  const configured = Number(process.env.REMINDER_SWEEP_MAX);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 200;
}

async function runReminderJob({ trigger = 'schedule', send = null } = {}) {
  // Everyone active, not just those owing: the report has to say what was checked as well as
  // what was found, or "0 owing" and "the query returned nothing" look identical.
  const members = await Member.find({ active: true })
    .select('name regNumber phone email emailNotifications photoUrl joinDate')
    .sort({ name: 1 })
    .lean();

  const dues = await computeMemberDues(members);

  const owing = members
    .map((member) => {
      const due = dues.get(String(member._id)) || { lateWeeks: [], fines: [], lateTotal: 0, finesTotal: 0, total: 0 };
      return {
        member,
        total: due.total,
        lateWeeks: due.lateWeeks.length,
        fines: due.fines.length,
        reachable: Boolean(member.email) && member.emailNotifications !== false,
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  const summary = {
    membersChecked: members.length,
    owingCount: owing.length,
    owingTotal: owing.reduce((sum, row) => sum + row.total, 0),
    reachableCount: owing.filter((row) => row.reachable).length,
    missingEmailCount: owing.filter((row) => !row.member.email).length,
    // The five largest, by name and amount: enough for the screen to be actionable without
    // carrying a copy of the ledger into a job record.
    worst: owing.slice(0, 5).map((row) => ({
      name: row.member.name,
      total: row.total,
      lateWeeks: row.lateWeeks,
      fines: row.fines,
    })),
    sent: 0,
    skipped: 0,
    failed: 0,
    mailed: false,
  };

  const shouldSend = send === null ? sendsEnabled() : Boolean(send);
  const targets = owing.filter((row) => row.reachable).slice(0, maxRecipients());

  // The other thing worth saying once a week, and for the same reason this whole file exists: the
  // failure it guards against is an absence, and an absence never announces itself. A copy of the
  // books that nobody has taken off the machine for two months is invisible on every screen until
  // somebody looks, so every run of the weekly sweep records how old the last copy is — whether or
  // not a single member email goes out, which is why it is set before the early returns below.
  const backup = await computeBackupHealth();
  summary.backup = {
    daysAgo: backup.daysAgo,
    never: backup.never,
    stale: backup.stale,
    staleAfterDays: backup.staleAfterDays,
    note: backup.note,
  };

  if (!shouldSend) {
    summary.note =
      'Report only. Set REMINDER_SWEEP_SEND=true to let this job email the members who are behind.';
    return summary;
  }
  if (!isMailConfigured()) {
    summary.note = 'REMINDER_SWEEP_SEND is on, but SMTP is not configured, so nothing was sent.';
    return summary;
  }
  if (targets.length === 0) {
    summary.note = 'Nobody reachable is behind. Nothing to send.';
    return summary;
  }

  const [settings, actor] = await Promise.all([getOrCreateSettings(), resolveSystemActor()]);

  const delivered = await deliverReminders({
    members: targets.map((row) => row.member),
    dues,
    settings,
    includeLate: true,
    includeFines: true,
    note: '',
    performedBy: actor._id,
  });

  summary.sent = delivered.sent;
  summary.skipped = delivered.skipped;
  summary.failed = delivered.failed;
  summary.mailed = true;
  summary.creditedTo = actor.email;
  logEvent('reminder_sweep_sent', {
    trigger,
    sent: delivered.sent,
    failed: delivered.failed,
  });

  return summary;
}

module.exports = { runReminderJob, sendsEnabled, maxRecipients };
