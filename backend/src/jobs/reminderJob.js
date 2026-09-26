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
//
// **And it respects the weekly budget.** A member who is behind stays behind until he pays, so a
// sweep that ran every Sunday, plus a treasurer pressing send whenever the screen is open, would
// say the same thing four times in a month. Settings.reminderMaxPerWeek (1 by default) is the
// number of reminders one member may have in a contribution week, counted from the audit trail
// (utils/reminderLog); the report says how many of the people who are behind have already had
// theirs, so a quiet Sunday is not mistaken for a Sunday with nothing to do.
const Member = require('../models/Member');
const { getOrCreateSettings } = require('../utils/settings');
const { isMailConfigured } = require('../utils/mailer');
const { computeBackupHealth } = require('../utils/backupHealth');
const {
  normaliseMaxPerWeek,
  weekWindow,
  sendsSince,
  allowanceFor,
} = require('../utils/reminderLog');
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
  //
  // `openingBalance` is on the projection for the money line, not for the report: what a member
  // holds starts with what he carried into the cycle, so a sweep that cannot see it reads every
  // member as holding nothing and emails the ones who are furthest ahead (utils/reminderLimit).
  const members = await Member.find({ active: true })
    .select('name regNumber phone email emailNotifications photoUrl joinDate openingBalance')
    .sort({ name: 1 })
    .lean();

  const settings = await getOrCreateSettings();
  // The group's own row, handed in so the money line and the weekly budget come from one read.
  const dues = await computeMemberDues(members, { settings });

  const owing = members
    .map((member) => {
      const due = dues.get(String(member._id)) || { lateWeeks: [], fines: [], lateTotal: 0, finesTotal: 0, total: 0 };
      return {
        member,
        total: due.total,
        lateWeeks: due.lateWeeks.length,
        fines: due.fines.length,
        reachable: Boolean(member.email) && member.emailNotifications !== false,
        // Worth knowing about even though he is not in this sweep: he *is* behind on the
        // week-by-week count, and the group's own rule is that he is not written to about it, so
        // the report names him rather than leaving the difference unexplained.
        heldOff: Boolean(due.coveredByBalance),
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  // Everybody the group's money line took off this run's list, whether or not a fine keeps him in
  // it: he is behind by the week-by-week count and that is exactly why the report says so instead
  // of reporting a smaller number than the ledger holds.
  const heldByBalance = members
    .map((member) => ({ member, due: dues.get(String(member._id)) || {} }))
    .filter((row) => (row.due.lateWeeksIgnored || 0) > 0)
    .map((row) => ({
      name: row.member.name,
      moneyHeld: row.due.moneyHeld || 0,
      lateWeeks: row.due.lateWeeksIgnored,
    }))
    .sort((a, b) => b.moneyHeld - a.moneyHeld);

  // The weekly budget, read before the summary so the report can tell tonight's work from what
  // was already done on Tuesday. Without it the screen says "32 behind" about nine people who
  // were emailed three days ago, which is precisely the misreading that ends with somebody
  // pressing send again — the habit the budget exists to break.
  //
  // Always read, even with no limit set: the same map is what the report uses to say who has
  // already been emailed, and that question does not stop mattering when the cap is off.
  const maxPerWeek = normaliseMaxPerWeek(settings.reminderMaxPerWeek);
  const { since, weekStart } = weekWindow();
  const sentThisWeek = await sendsSince(members.map((member) => member._id), since);
  const sentCountFor = (row) => sentThisWeek.get(String(row.member._id))?.count || 0;
  const stillAllowed = (row) => allowanceFor(sentCountFor(row), maxPerWeek).allowed;

  const summary = {
    membersChecked: members.length,
    owingCount: owing.length,
    owingTotal: owing.reduce((sum, row) => sum + row.total, 0),
    reachableCount: owing.filter((row) => row.reachable).length,
    missingEmailCount: owing.filter((row) => !row.member.email).length,
    // How many of those who are behind have already had this week's reminder, and how many are
    // still within their budget. The two numbers are what make the report honest about a
    // quiet-looking run.
    weeklyLimit: maxPerWeek,
    weekStart,
    alreadyEmailedThisWeek: owing.filter((row) => row.reachable && sentCountFor(row) > 0).length,
    awaitingReminder: owing.filter((row) => row.reachable && stillAllowed(row)).length,
    heldByLimit: owing.filter((row) => row.reachable && !stillAllowed(row)).length,
    // The other reason a name is not in this sweep, and the one the committee will ask about:
    // members holding at least the group's own line are not told they are behind (Settings →
    // Reminders, utils/reminderLimit). Counted and named, because a report that quietly checked
    // fewer people than the ledger has is a report somebody stops trusting.
    moneyLimit: [...dues.values()][0]?.moneyLimit || 0,
    heldByBalanceCount: heldByBalance.length,
    heldByBalance: heldByBalance.slice(0, 5),
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
  // Only the members still inside their weekly budget are targets. The cap is enforced again
  // inside deliverReminders — that copy is the one that counts, because the reminders screen
  // uses it too — but leaving a capped member out here means a sweep with nothing to actually
  // send says so without opening an SMTP connection first.
  const targets = owing
    .filter((row) => row.reachable && stillAllowed(row))
    .slice(0, maxRecipients());

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
    summary.note = 'REMINDER_SWEEP_SEND is on, but email is not configured, so nothing was sent.';
    return summary;
  }
  if (targets.length === 0) {
    // Three different quiet weeks, said differently. "Nobody is behind", "everybody behind has
    // already been told" and "everybody behind is holding enough that the group does not chase
    // him" look identical in a count and mean entirely different things to the committee.
    if (summary.heldByLimit > 0) {
      summary.note =
        `Nobody to email today: the ${summary.heldByLimit} `
        + `${summary.heldByLimit === 1 ? 'reachable member' : 'reachable members'} who `
        + `${summary.heldByLimit === 1 ? 'is' : 'are'} behind already `
        + `${summary.heldByLimit === 1 ? 'has' : 'have'} this week's reminder `
        + `(limit ${maxPerWeek} per week — see Reminders per member per week in Settings).`;
    } else if (summary.heldByBalanceCount > 0) {
      summary.note =
        `Nobody to email today. ${summary.heldByBalanceCount} `
        + `${summary.heldByBalanceCount === 1 ? 'member is' : 'members are'} behind on a closed `
        + `week but ${summary.heldByBalanceCount === 1 ? 'holds' : 'hold'} at least `
        + `${summary.moneyLimit.toLocaleString('en-KE')} — above the group's own line, so `
        + `${summary.heldByBalanceCount === 1 ? 'he is' : 'they are'} not told (Settings → Reminders).`;
    } else {
      summary.note = 'Nobody reachable is behind. Nothing to send.';
    }
    return summary;
  }

  const actor = await resolveSystemActor();

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
  // Anybody this batch left at the cap because the count moved between the two reads — the
  // check above chose the targets, this one is the record of what actually went.
  summary.skippedByWeeklyLimit = delivered.skippedByWeeklyLimit;
  // And anybody the money line turned away inside the batch: a member can cross it between the
  // report and the send (a payment lands), and the sweep must record what it actually did.
  summary.skippedByMoneyLimit = delivered.skippedByMoneyLimit;
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
