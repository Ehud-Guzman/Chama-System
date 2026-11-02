// The reminders controller, part: read. controllers/notificationController.js is the index the routes use.

const Member = require('../../models/Member');
const AuditLog = require('../../models/AuditLog');
const { describeMailConfig } = require('../../utils/mailer');
const { getOrCreateSettings } = require('../../utils/settings');
const { normaliseMaxPerWeek, weekWindow, sendsSince, allowanceFor, HISTORY_MAX, HISTORY_LIMIT, kindLabel } = require('../../utils/reminderLog');
const { resolveConfig, currentWeekNumber } = require('../../utils/weekCycle');
const { lineStep } = require('../../utils/reminderLimit');
const { computeMemberDues } = require('./dues');

// GET /api/notifications/status — is this deployment able to send at all?
//
// `configured` is about the variables, not about reachability: a host that holds the SMTP_*
// values and cannot open the connection reports itself configured and still sends nothing.
// A batch is the honest test, because it proves the connection before it sends anything and
// reports the provider's own words when it cannot.
async function mailStatus(req, res) {
  res.json(describeMailConfig());
}

// GET /api/notifications/reminders?onlyOwing=1 — every active member, with what
// they owe and whether we can actually reach them.
async function listReminders(req, res, next) {
  try {
    const onlyOwing = req.query.onlyOwing !== '0';

    // `openingBalance` is not for the list — it is half of what the money line is measured against
    // (utils/reminderLimit): the money a member holds is his carried-in balance, plus what he has
    // paid since the cycle opened, less the tea. A projection that leaves it out reads every member
    // as having carried in nothing, which silently turns "leave the members who are ahead alone"
    // into "chase everybody who missed a week" — the members with the most money being the ones who
    // get emailed. computeMemberDues reads the field itself if a caller forgets it, but the one
    // query that loads every active member should not be the one that pays for it.
    const members = await Member.find({ active: true })
      .select('name regNumber phone email emailNotifications photoUrl joinDate openingBalance fineDebits')
      .sort({ name: 1 })
      .lean();

    // One read of the group's policy row, used for both the money line and the weekly budget — and
    // handed to computeMemberDues so the two cannot be answering from different copies of it.
    const settings = await getOrCreateSettings();
    const dues = await computeMemberDues(members, { settings });

    // What each member has already been sent this week, so the screen can say so before anybody
    // ticks a name — and so a member who is already at his limit cannot be ticked by accident.
    // Read from the audit trail rather than tracked separately: a send that happened is a fact
    // already written down, and a second counter is a second thing that can disagree with it.
    const weeklyLimit = normaliseMaxPerWeek(settings.reminderMaxPerWeek);
    const { since, weekStart } = weekWindow();
    const sentThisWeek = await sendsSince(members.map((m) => m._id), since);

    const rows = members.map((m) => {
      const due = dues.get(String(m._id)) || {
        lateWeeks: [],
        lateWeeksIgnored: 0,
        fines: [],
        finesTotal: 0,
        lateTotal: 0,
        total: 0,
        moneyHeld: 0,
        moneyLimit: 0,
        coveredByBalance: false,
      };
      const sent = sentThisWeek.get(String(m._id));
      const allowance = allowanceFor(sent?.count || 0, weeklyLimit);
      return {
        id: m._id,
        name: m.name,
        regNumber: m.regNumber || null,
        phone: m.phone,
        photoUrl: m.photoUrl || '',
        email: m.email || '',
        emailNotifications: m.emailNotifications !== false,
        lateWeeksCount: due.lateWeeks.length,
        lateTotal: due.lateTotal,
        finesCount: due.fines.length,
        finesTotal: due.finesTotal,
        total: due.total,
        // What he holds, and whether that is why he is missing from "who owes what". On the row so
        // the screen can name the reason instead of leaving a name unexplained.
        moneyHeld: due.moneyHeld,
        coveredByBalance: due.coveredByBalance,
        lateWeeksIgnored: due.lateWeeksIgnored || 0,
        // Reminders already sent this contribution week, and whether the budget is spent. The
        // screen disables a member at the limit rather than letting a send come back skipped.
        remindersThisWeek: allowance.sent,
        lastReminderAt: sent?.lastAt || null,
        reminderCapReached: !allowance.allowed,
      };
    });

    const visible = rows.filter((r) => !onlyOwing || r.total > 0);
    visible.sort((a, b) => b.total - a.total);

    // Members the money line took off this list. Counted here rather than left implicit: a screen
    // that silently showed fewer names than the week-by-week schedule has would look like a bug.
    const covered = rows.filter((r) => r.coveredByBalance);
    // The line itself, read off the dues rather than recomputed here — every entry carries the same
    // figure, so a second calculation would only be a second chance to disagree with the rows.
    const config = resolveConfig(settings);
    const moneyLimit = [...dues.values()][0]?.moneyLimit || 0;

    res.json({
      // The host, the port and the sending address travel with the list, so the screen
      // can say what a batch will be sent as, and from where, without a second request.
      ...describeMailConfig(),
      members: visible,
      owingCount: rows.filter((r) => r.total > 0).length,
      reachableCount: visible.filter((r) => r.email && r.emailNotifications).length,
      // Why a member can't be emailed — surfaced in the UI so it's obvious the
      // fix is to add an address, not to keep pressing send.
      missingEmailCount: visible.filter((r) => !r.email).length,
      // The line, and who it took off the list: the money a member must be holding to be left
      // alone, where that line stands this week, and how many names it explains (utils/reminderLimit).
      moneyLimit,
      weeklyAmount: config.weeklyAmount,
      // What the money line rises by each week: the whole weekly contribution.
      moneyLimitStep: lineStep(config),
      currentWeek: currentWeekNumber(config),
      coveredCount: covered.length,
      coveredNames: covered.slice(0, 5).map((r) => r.name),
      // The budget, and how much of it has been spent: the window is the group's own week, so
      // the numbers here are comparable with the weeks on the member's passbook.
      weeklyLimit,
      weekStart,
      emailedThisWeek: rows.filter((r) => r.remindersThisWeek > 0).length,
      emailsThisWeek: rows.reduce((sum, r) => sum + r.remindersThisWeek, 0),
      atCapCount: rows.filter((r) => r.reminderCapReached).length,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/notifications/history?limit=50 — who has been emailed, and what about.
//
// The audit trail has recorded every send since reminders existed, and nothing ever read it
// back: an office asking "was Joseph told?" had a request-log line and no screen. This is that
// screen's data. It carries all three kinds this system emails — a reminder, a fine being
// issued, a fine being paid — because the question is really "what has this system been saying
// to our members?", and an answer that left out the automatic ones would mislead.
async function reminderHistory(req, res, next) {
  try {
    const requested = Number(req.query.limit);
    const pageSize =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), HISTORY_MAX)
        : HISTORY_LIMIT;

    const entries = await AuditLog.find({ entityType: 'Notification' })
      .select('entityId performedBy createdAt after')
      .sort({ createdAt: -1 })
      .limit(pageSize)
      .populate('performedBy', 'name')
      .lean();

    // One lookup for every name on the page rather than a populate per row: `entityId` has no
    // declared ref, because the same field holds a member here and something else for another
    // entity type, and a `ref` that is only right sometimes is worse than no `ref`.
    const ids = [...new Set(entries.map((entry) => String(entry.entityId)))];
    const members = ids.length
      ? await Member.find({ _id: { $in: ids } }).select('name regNumber email').lean()
      : [];
    const byId = new Map(members.map((member) => [String(member._id), member]));

    const { weekStart } = weekWindow();

    const rows = entries.map((entry) => {
      const member = byId.get(String(entry.entityId));
      const after = entry.after || {};
      return {
        id: entry._id,
        memberId: String(entry.entityId),
        name: member?.name || 'A member who has since left',
        regNumber: member?.regNumber || null,
        // The address it actually went to, as it was recorded at the time — a member who has
        // since changed his address should still be shown where the message he received went.
        to: after.to || member?.email || '',
        kind: after.kind || 'reminder',
        kindLabel: kindLabel(after.kind),
        subject: after.subject || '',
        sentAt: entry.createdAt,
        // Who pressed send: a named account, or the system for the sweep and the fine emails
        // (the sweep credits the supervising account, utils/systemActor, so it reads as itself).
        sentBy: entry.performedBy
          ? { id: entry.performedBy._id, name: entry.performedBy.name }
          : { id: null, name: 'The system' },
      };
    });

    res.json({
      entries: rows,
      limit: pageSize,
      total: rows.length,
      weekStart,
      // What the weekly budget has been spent on so far, over every member — the number the
      // screen puts beside the per-member counts so the two cannot be read as disagreeing.
      remindersThisWeek: rows.filter(
        (row) => row.kind === 'reminder' && new Date(row.sentAt) >= new Date(weekStart)
      ).length,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listReminders,
  mailStatus,
  reminderHistory,
};
