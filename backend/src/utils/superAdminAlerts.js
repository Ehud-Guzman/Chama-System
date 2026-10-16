// Telling the super admin when something happens that they would want to know about
// today rather than the next time they open the audit screen.
//
// Two things trigger it: an entry in the trail that is the shape of money or access moving
// (an amount cut, money removed, a row moved to another member, a role or a phone number
// changed), and a burst of failed sign-ins against one account or from one address.
//
// Like every other email in this system it can never hold up the thing that caused it. It
// does not throw, it is not awaited by the request, and a mail server that is down is a line
// in the request log. It is also quiet by construction: only the super admin hears, only for
// someone else's actions, and no more than a handful an hour.
//
// SECURITY_ALERTS=off switches it off for a deployment that does not want it. On by default,
// like the fine emails: it is a message to one person who asked for oversight.
const User = require('../models/User');
const { readAuditEntry } = require('./auditFlags');
const { logEvent } = require('../middleware/requestLogger');

const OFF_VALUES = new Set(['off', 'false', 'no', '0', 'disabled']);

function alertsEnabled() {
  const raw = String(process.env.SECURITY_ALERTS ?? '').trim().toLowerCase();
  if (!raw) return true;
  return !OFF_VALUES.has(raw);
}

// The flags that justify a message. Not every "high" flag: a group-wide week collection is
// high and happens weekly, and an email that arrives every Monday is one that stops being
// opened. These are the ones that, if they were not the super admin's own doing, they would
// want to hear about.
const ALERT_FLAGS = new Set([
  'money-removed',
  'amount-cut',
  'moved-member',
  'credential',
  'opening-balance',
  'role-changed',
]);

// Failed sign-ins before it is a pattern rather than a typo.
const FAILURE_THRESHOLD = 5;
// Failed tries at the members' gate from one address. Higher than a sign-in's: a member behind a
// shared connection mistypes his number now and then, and ten in a quarter of an hour is a script.
const GATE_ADDRESS_THRESHOLD = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

// At most this many messages an hour from one process. A bulk delete of fifty rows is fifty
// serious entries and should be one message, not fifty. The excess is logged, and the
// oversight screen still lists every one of them.
const MAX_PER_HOUR = 6;
const HOUR_MS = 60 * 60 * 1000;
let sentAt = [];

// Pure: which flags on this entry deserve a message, or none.
function alertableFlags(entry) {
  return readAuditEntry(entry).flags.filter((f) => ALERT_FLAGS.has(f.key) || (f.key === 'group-wide' && entry.action === 'reset'));
}

// Pure: has this process used up its hour?
function withinBudget(now = Date.now()) {
  sentAt = sentAt.filter((t) => now - t < HOUR_MS);
  if (sentAt.length >= MAX_PER_HOUR) return false;
  sentAt.push(now);
  return true;
}

function resetBudget() {
  sentAt = [];
}

async function superAdminAddresses() {
  const supers = await User.find({ role: 'super_admin', active: true }).select('email').lean();
  return supers.map((u) => u.email).filter(Boolean);
}

async function send({ subject, lines }) {
  // Required here, not at the top: the mailer pulls in the request logger and the settings
  // helper, and the audit logger — which reaches this file — is required by nearly everything.
  const { isMailConfigured, sendMail, describeMailError, buildSecurityAlertEmail } = require('./mailer');
  const { getOrCreateSettings } = require('./settings');

  if (!isMailConfigured()) return { sent: false, reason: 'Email sending is not set up' };
  const to = await superAdminAddresses();
  if (to.length === 0) return { sent: false, reason: 'No active super admin to tell' };

  try {
    const settings = await getOrCreateSettings();
    const message = buildSecurityAlertEmail({ chamaName: settings.chamaName, subject, lines });
    await sendMail({ to: to.join(', '), ...message });
    logEvent('security_alert_sent', { subject });
    return { sent: true };
  } catch (err) {
    logEvent('security_alert_failed', { subject, error: describeMailError(err) }, 'error');
    return { sent: false, reason: describeMailError(err) };
  }
}

// Called by the audit logger once an entry is safely written. `entry` is the stored document.
async function alertOnAuditEntry(entry) {
  try {
    if (!alertsEnabled() || !entry) return;
    const flags = alertableFlags(entry);
    if (flags.length === 0) return;

    // Only another person's actions are news. The super admin cutting an amount knows.
    const actor = await User.findById(entry.performedBy).select('name role').lean();
    if (!actor || actor.role === 'super_admin') return;

    if (!withinBudget()) {
      logEvent('security_alert_throttled', { entityType: entry.entityType, action: entry.action });
      return;
    }

    const read = readAuditEntry(entry);
    await send({
      subject: `${actor.name} — ${flags.map((f) => f.label).join(', ')}`,
      lines: [
        `${actor.name} (${actor.role.replace('_', ' ')}) ${entry.action}d a ${entry.entityType
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .toLowerCase()}.`,
        read.summary ? `What changed: ${read.summary}` : null,
        `Flagged as: ${flags.map((f) => f.label).join(', ')}.`,
        'Open the audit trail and filter to "Unusual only" to see it in context.',
      ].filter(Boolean),
    });
  } catch (err) {
    logEvent('security_alert_failed', { error: err.message }, 'error');
  }
}

// Called after a failed sign-in has been stored. `count` is how many from the same account
// (or the same address) there have been inside the window, this one included. It fires on the
// crossing, not on every failure after it, so an attack is one message and not a hundred.
async function alertOnFailedSignIns({ email, ip, countByEmail, countByIp, accountExists }) {
  try {
    if (!alertsEnabled()) return;
    let subject = null;
    let line = null;

    if (countByEmail === FAILURE_THRESHOLD) {
      subject = `${FAILURE_THRESHOLD} failed sign-ins on ${email}`;
      line = accountExists
        ? `${FAILURE_THRESHOLD} wrong passwords or codes for ${email} in the last 15 minutes. That is an account somebody is guessing at.`
        : `${FAILURE_THRESHOLD} sign-ins in 15 minutes for ${email}, which is not an account here.`;
    } else if (countByIp === FAILURE_THRESHOLD) {
      subject = `${FAILURE_THRESHOLD} failed sign-ins from one address`;
      line = `${FAILURE_THRESHOLD} failed sign-ins from ${ip || 'one address'} in the last 15 minutes, across one or more accounts.`;
    }
    if (!subject) return;

    if (!withinBudget()) {
      logEvent('security_alert_throttled', { kind: 'failed_sign_ins' });
      return;
    }
    await send({
      subject,
      lines: [line, 'Nothing has been locked: the sign-in page already slows an address down. Open Audit → Oversight to see who is being tried.'],
    });
  } catch (err) {
    logEvent('security_alert_failed', { error: err.message }, 'error');
  }
}

// A try at the members' gate that failed has just been stored. Two things are worth a message:
// somebody guessing the phone number on one real member's passbook (the ID is right, the phone is
// not — that is an attack on a person), and one address working through ID numbers.
async function alertOnGateFailures({ ip, countByIp, countByTarget, memberName }) {
  try {
    if (!alertsEnabled()) return;
    let subject = null;
    let line = null;

    if (countByTarget === FAILURE_THRESHOLD) {
      subject = `${FAILURE_THRESHOLD} wrong phone numbers on ${memberName || 'a member'}'s passbook`;
      line = `${FAILURE_THRESHOLD} wrong phone numbers were tried against ${memberName || 'one member'}'s passbook in the last 15 minutes, with the right ID. Somebody has that ID and is guessing the number. The passbook locks for that ID after ${Number(process.env.GATE_TARGET_MAX) || 15} misses; it is worth telling the member.`;
    } else if (countByIp === GATE_ADDRESS_THRESHOLD) {
      subject = `${GATE_ADDRESS_THRESHOLD} failed member lookups from one address`;
      line = `${GATE_ADDRESS_THRESHOLD} failed tries at the members' gate from ${ip || 'one address'} in the last 15 minutes. That is more than a mistyped number — it looks like someone working through ID numbers.`;
    }
    if (!subject) return;

    if (!withinBudget()) {
      logEvent('security_alert_throttled', { kind: 'gate_failures' });
      return;
    }
    await send({
      subject,
      lines: [line, 'Open Audit → Oversight to see the tries.'],
    });
  } catch (err) {
    logEvent('security_alert_failed', { error: err.message }, 'error');
  }
}

module.exports = {
  alertOnGateFailures,
  GATE_ADDRESS_THRESHOLD,
  alertsEnabled,
  alertableFlags,
  alertOnAuditEntry,
  alertOnFailedSignIns,
  withinBudget,
  resetBudget,
  FAILURE_THRESHOLD,
  FAILURE_WINDOW_MS,
  MAX_PER_HOUR,
};
