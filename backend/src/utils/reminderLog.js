const AuditLog = require('../models/AuditLog');
const { fridayOf } = require('./weekCycle');

// Who has already been emailed this week, and how many times.
//
// Two problems live here, and they are the same problem seen from two sides.
//
// The first: a member who is behind stays behind until he pays. The weekly sweep runs every
// Sunday, and the reminders screen sends whenever somebody has it open — so a member who owes
// week 93 gets the same message on Sunday, again on Tuesday, and again the Sunday after, which
// is not a reminder but a nuisance, and a nuisance is what makes people stop reading them. So a
// member has a budget: Settings.reminderMaxPerWeek (default 1) reminders per contribution week.
//
// The second: "who have we actually emailed, and about what?" had no answer anywhere. A send
// wrote a line to the request log and a `Notification` entry to the audit trail, and neither was
// ever read back — so an office arguing about whether a member was told could not show it. Both
// the budget and the answer are read from that one audit entry, rather than from a second store
// that could disagree with it.
//
// The week is the group's own week — Friday 00:00 EAT → Thursday (§7.4), the same window the
// ledger counts in (utils/weekCycle), so "this week" on this screen means what it means
// everywhere else. Counting instead from the last seven days would let a Tuesday send and the
// following Sunday's sweep both count as separate weeks while the member's ledger says one.
//
// A reminder entry is written with `after.kind = 'reminder'` (notificationController). Entries
// written before that field existed carry `channel: 'email'` and no kind, and they are counted
// too — the alternative is a cap that forgets this week's sends on the day it is deployed.
// Fine emails are excluded: they are a record of something that happened to the member, not a
// nudge, and `after.kind` names them ('fine_issued', 'fine_paid').

// One a week. The point of a reminder is that it is read, and the second copy of the same
// message is the one that stops the first being read.
const DEFAULT_MAX_PER_WEEK = 1;

// A ceiling on the setting rather than a free number: nothing this system does needs more than
// a handful, and an office typing 500 by mistake should be told, not obeyed.
const MAX_PER_WEEK_CEILING = 20;

// The most recent sends the history screen reads in one page.
const HISTORY_LIMIT = 50;
const HISTORY_MAX = 200;

// The kinds an audit entry can carry and be a reminder. `null` covers the entries written
// before the kind was recorded.
const REMINDER_KINDS = [null, 'reminder'];

// The words the history screen prints for each kind of email this system sends.
const KIND_LABELS = {
  reminder: 'Reminder',
  fine_issued: 'Fine issued',
  fine_paid: 'Fine payment',
};

// The setting is read from the database, so a value posted to /api/settings could be anything.
// Coerced here rather than trusted: a string, a fraction or a negative would otherwise produce
// a limit nobody can reason about ('3' < 3 is false in JavaScript, which would silently make the
// cap unlimited). 0 means no limit, and is a real choice — a group that wants a reminder every
// week should not have to fight the software.
function normaliseMaxPerWeek(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_PER_WEEK;
  // A form posts blank as '' or as spaces, and `Number('   ')` is 0 — which would read as "no
  // limit" and quietly undo the cap for a field somebody merely tabbed through.
  if (typeof value === 'string' && value.trim() === '') return DEFAULT_MAX_PER_WEEK;
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_MAX_PER_WEEK;
  const whole = Math.floor(number);
  if (whole < 0) return 0;
  return Math.min(whole, MAX_PER_WEEK_CEILING);
}

// The window a budget is spent in: Friday 00:00 EAT of the week containing `now`, which is the
// group's own contribution week (§7.4). `since` is what the query filters on and `weekStart` is
// what a screen prints, and they are the same instant.
function weekWindow(now = new Date()) {
  const since = fridayOf(now);
  return { since, weekStart: since };
}

// The audit entries that are reminder emails to these members, since that instant. Exported
// because the history screen asks a slightly different question of the same records (everything,
// not just this week) and the two must agree about what counts as a reminder.
function reminderFilter({ memberIds = null, since = null } = {}) {
  return {
    entityType: 'Notification',
    'after.channel': 'email',
    'after.kind': { $in: REMINDER_KINDS },
    ...(memberIds ? { entityId: { $in: memberIds } } : {}),
    ...(since ? { createdAt: { $gte: since } } : {}),
  };
}

// How many reminders each member has had in the window, and when the last one went. One query
// for the whole batch rather than one per member — the reminders screen loads every active
// member, and a query each would be a hundred round trips to answer a question about a list.
//
// Read newest-first and keep the first sighting of each member, so `lastAt` is the latest send
// without a second pass.
async function sendsSince(memberIds, since) {
  const ids = (memberIds || []).filter(Boolean);
  if (ids.length === 0) return new Map();

  const rows = await AuditLog.find(reminderFilter({ memberIds: ids, since }))
    .select('entityId createdAt after.subject after.to')
    .sort({ createdAt: -1 })
    .lean();

  const byMember = new Map();
  for (const row of rows) {
    const key = String(row.entityId);
    const seen = byMember.get(key);
    if (seen) {
      seen.count += 1;
      continue;
    }
    byMember.set(key, {
      count: 1,
      lastAt: row.createdAt,
      to: row.after?.to || '',
      subject: row.after?.subject || '',
    });
  }
  return byMember;
}

// The decision, as a pure function of (how many he has had, what the limit is): the screen, the
// sweep and the test all ask it the same way. `remaining` is null when there is no limit, so a
// caller cannot subtract its way to a number that means nothing.
function allowanceFor(count, maxPerWeek) {
  const max = normaliseMaxPerWeek(maxPerWeek);
  const sent = Math.max(0, Math.floor(Number(count) || 0));

  if (max === 0) return { unlimited: true, max, sent, remaining: null, allowed: true };
  return { unlimited: false, max, sent, remaining: Math.max(max - sent, 0), allowed: sent < max };
}

// Why a member was left out, in the words the office needs: what happened, the limit that did it,
// and where to change it. "Already emailed" alone invites the send button to be pressed again.
function overLimitReason(allowance) {
  const times = allowance.sent === 1 ? 'once' : `${allowance.sent} times`;
  return (
    `Already emailed ${times} this week (limit ${allowance.max}) — `
    + 'raise Reminders per member per week in Settings to send more.'
  );
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || KIND_LABELS.reminder;
}

module.exports = {
  DEFAULT_MAX_PER_WEEK,
  MAX_PER_WEEK_CEILING,
  HISTORY_LIMIT,
  HISTORY_MAX,
  KIND_LABELS,
  normaliseMaxPerWeek,
  weekWindow,
  reminderFilter,
  sendsSince,
  allowanceFor,
  overLimitReason,
  kindLabel,
};
