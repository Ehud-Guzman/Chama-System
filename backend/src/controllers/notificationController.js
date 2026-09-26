const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const Fine = require('../models/Fine');
const AuditLog = require('../models/AuditLog');
// Required for the populate in computeMemberDues, not for anything named below: mongoose
// resolves a `ref` by name when the query runs, so the model has to be registered in the
// process, by whoever else happens to be there. The API process gets away with not doing it
// here because fineTypeRoutes imports the model on the way past — which is exactly why the
// omission went unnoticed until the reminder sweep was run by hand (`npm run job:reminders`,
// a process that boots no routes) and died with "Schema hasn't been registered for
// model \"FineType\"" instead of sending anything.
require('../models/FineType');
const { getOrCreateSettings } = require('../utils/settings');
const { resolveConfig, currentWeekNumber } = require('../utils/weekCycle');
const { WEEKLY_TYPE_NAME, bucketForType } = require('../utils/ledgerTypes');
const { computeMemberLedger } = require('../utils/memberLedger');
const {
  assertMailConfigured,
  describeMailConfig,
  describeMailError,
  mailFailure,
  sendMail,
  verifyMail,
  buildReminderEmail,
} = require('../utils/mailer');
const { logAudit } = require('../utils/auditLogger');
// The request log is where "emails are not being sent" gets its evidence: a request the
// office gives up on leaves no line of its own (only a finished response is logged), so
// the outcome of every send has to be written down as it happens, not only returned in
// a response somebody may never see.
const { logEvent } = require('../middleware/requestLogger');
// The weekly budget, and the answer to "who have we emailed?" — both read back from the audit
// entry every send writes. See utils/reminderLog for why the count lives there and not in a
// collection of its own.
const {
  normaliseMaxPerWeek,
  weekWindow,
  sendsSince,
  allowanceFor,
  overLimitReason,
  kindLabel,
  HISTORY_LIMIT,
  HISTORY_MAX,
} = require('../utils/reminderLog');
// Who the group stops chasing: a member holding at least this much is not told he is behind, and
// the line moves 1,400 a week with the collection itself. See utils/reminderLimit — and note that
// it decides who is written to and never what the books say.
const {
  moneyLimitForWeek,
  coveredByBalance,
  aboveLimitReason,
} = require('../utils/reminderLimit');

// One request should never try to email the whole group and then time out — the
// page selects a handful at a time, and the sends happen inside this request. Fifty
// is roughly a minute of SMTP at three connections, which is as long as an HTTP
// request here can honestly be expected to take; a larger selection is refused with
// a message asking for batches (the alternative — sending in the background — needs
// a job store and a way to tell the treasurer how it went).
const MAX_RECIPIENTS = 50;

// Works out exactly what a set of members still owes: unpaid weekly
// contribution weeks and unpaid fines. This is the same maths the member's own
// page shows (computeMemberLedger), so an email can never claim something
// the member's own statement contradicts.
//
// **And it works out who is not to be told about it.** A member holding at least the group's own
// moving line (Settings.reminderMoneyLimit, utils/reminderLimit) has his late weeks taken out of
// what he "owes" for the purpose of being written to: he is behind on the week-by-week count and by
// that count alone, and the treasurer's own instruction is that he is not nagged about it. The
// weeks themselves are kept in `lateWeeksIgnored` rather than thrown away, so the reminders screen
// can still say why he was left alone. His fines stay: a fine is not a weekly nudge.
async function computeMemberDues(members, { settings: givenSettings = null } = {}) {
  const ids = members.map((m) => m._id);
  if (ids.length === 0) return new Map();

  const [types, settings, contributions, pendingFines] = await Promise.all([
    ContributionType.find().select('name isGroupFund isWeekly').lean(),
    // A caller that already loaded the settings row passes it in: the weekly sweep and the
    // reminders screen both have it, and a second read would be a second answer waiting to happen.
    givenSettings ? Promise.resolve(givenSettings) : getOrCreateSettings(),
    Contribution.find({ memberId: { $in: ids }, deleted: false })
      .select('memberId typeId amount grossAmount date')
      .lean(),
    Fine.find({ memberId: { $in: ids }, deleted: false, remaining: { $gt: 0 } })
      .populate('typeId', 'name')
      .lean(),
  ]);

  const config = resolveConfig(settings);
  // The line as it stands this week, or 0 when the rule is switched off.
  const weekNumber = currentWeekNumber(config);
  const moneyLimit = moneyLimitForWeek(settings, config, weekNumber);
  const typeById = new Map(types.map((t) => [String(t._id), t]));
  const byMember = new Map();
  for (const c of contributions) {
    const type = typeById.get(String(c.typeId));
    const annotated = {
      ...c,
      bucket: bucketForType(type),
      isGroupFund: Boolean(type && type.isGroupFund),
    };
    const key = String(c.memberId);
    if (!byMember.has(key)) byMember.set(key, []);
    byMember.get(key).push(annotated);
  }

  // The week requirements come from the same cycle engine the treasurer logs
  // against, so a reminder can never quote a different week number or a
  // different amount from the member's own page. Weeks before the cycle
  // started simply aren't in the ledger, so unreconcilable history can't be
  // emailed to anyone — the old per-member-join-date schedule could, and did.
  const dues = new Map();

  for (const member of members) {
    const ledger = computeMemberLedger({
      member,
      contributions: byMember.get(String(member._id)) || [],
      config,
    });

    // `settled` rather than `status`: a week covered out of earlier credit is not
    // late, and the opening week is the baseline — nothing was expected of it, so
    // it can never be late either. This is exactly what the ledger's own
    // weeksBehind counts, so a reminder can never contradict the member's page.
    const lateWeeks = ledger.weeks
      .filter((w) => !w.isBaseline && !w.isCurrent && !w.settled)
      .map((w) => ({
        weekNumber: w.weekNumber,
        startDate: w.startDate,
        typeName: WEEKLY_TYPE_NAME,
        expected: ledger.weeklyAmount,
        paid: w.personalPaid,
        shortfall: Math.max(ledger.weeklyAmount - w.personalPaid, 0),
      }));

    const fines = pendingFines
      .filter((f) => String(f.memberId) === String(member._id))
      .map((f) => ({
        id: f._id,
        reason: f.reason || f.typeId?.name || 'Fine',
        date: f.date,
        remaining: f.remaining,
      }));

    const finesTotal = fines.reduce((sum, f) => sum + f.remaining, 0);
    const lateTotal = lateWeeks.reduce((sum, w) => sum + w.shortfall, 0);

    // Above the line, the late weeks stop being something he is told about. They are not thrown
    // away: `lateWeeksIgnored` carries how many there were, so a screen can explain the row instead
    // of leaving the office to wonder whether the engine saw them.
    const covered = coveredByBalance(ledger.money, moneyLimit) && lateWeeks.length > 0;

    dues.set(String(member._id), {
      lateWeeks: covered ? [] : lateWeeks.sort((a, b) => a.weekNumber - b.weekNumber),
      lateWeeksIgnored: covered ? lateWeeks.length : 0,
      fines,
      finesTotal,
      lateTotal: covered ? 0 : lateTotal,
      // What the group is holding for him, and the line it was measured against. On the payload so
      // the screen and the audit trail can both say what the decision was made of.
      moneyHeld: ledger.money,
      moneyLimit,
      weekNumber,
      coveredByBalance: covered,
      total: finesTotal + (covered ? 0 : lateTotal),
    });
  }

  return dues;
}

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

    const members = await Member.find({ active: true })
      .select('name regNumber phone email emailNotifications photoUrl joinDate')
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

// The sending itself, separated from the request that asked for it.
//
// Two things send reminders now: the reminders screen, where an admin picks members and
// presses send, and the weekly sweep, where nobody is watching. They must not be two
// implementations — a member who is emailed by the sweep has to get the same message, off
// the same figures, as one emailed by hand, or the two will disagree about what he owes.
//
// `performedBy` is the account credited in the audit trail. For the sweep that is the
// supervising account rather than a person (utils/systemActor), which is why it is a
// parameter and not read off `req`.
async function deliverReminders({
  members,
  dues,
  settings,
  includeLate = true,
  includeFines = true,
  note = '',
  performedBy,
  // The request this batch belongs to, when a person asked for it: it ties these lines
  // to the one line that request writes when it finishes. The weekly sweep has no
  // request, so it passes nothing and its lines stand on their own.
  rid = null,
  // The weekly budget is a policy, not a lock: somebody with the authority to press send may
  // say "yes, this batch, on purpose" — a correction, or a member who asked to be told again.
  // It is not the default, and every use is recorded in the audit entry, because the cap exists
  // to stop accidents and nagging rather than to stop the office.
  ignoreWeeklyLimit = false,
}) {
  const cleanNote = String(note || '').trim().slice(0, 600);
  const results = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let skippedByWeeklyLimit = 0;
  // Named separately for the same reason as the weekly cap: "he holds enough that the group does
  // not chase him" is a decision, not a fault, and a batch that reported it as a plain skip would
  // have somebody hunting for a bug in the ledger.
  let skippedByMoneyLimit = 0;
  const startedAt = Date.now();

  // How many reminders each member in this batch has already had this contribution week, and
  // what the group allows (Settings.reminderMaxPerWeek — 1 by default, 0 for no limit). The
  // window is worked out once for the batch rather than per member, so a batch that starts at
  // 23:59 on a Thursday cannot count half its members against the week that just closed.
  //
  // Read even when there is no limit, because the number is not only the gate: it is what the
  // audit entry records and what the screen shows, and "1 of 1" written over a member's fourth
  // email of the week would be a false record of a true send.
  const maxPerWeek = normaliseMaxPerWeek(settings?.reminderMaxPerWeek);
  const { since, weekStart } = weekWindow();
  const sentThisWeek = await sendsSince(members.map((m) => m._id), since);

  // One connection, tried before the first message, because the alternative is one per
  // member: with a provider this host cannot reach, every send spends its own
  // connectionTimeout discovering the same fault, so fifty members becomes a quarter of
  // an hour of waiting — and the office, whose browser gives up after twenty seconds,
  // hears a timeout rather than the reason. Failing here costs a single wait, names the
  // fault, and is also what the weekly sweep records in its job run.
  //
  // It sends nothing, so a deployment whose mail is broken says so the moment somebody
  // presses send instead of after a batch of silent failures.
  try {
    await verifyMail();
  } catch (err) {
    logEvent('reminder_smtp_unavailable', { rid, error: describeMailError(err) }, 'error');
    // Written for a person and marked readable, so the batch is refused with the reason
    // rather than with "Something went wrong".
    throw mailFailure(err);
  }

  const skip = (member, reason) => {
    skipped += 1;
    results.push({ id: member._id, name: member.name, email: member.email || '', status: 'skipped', reason });
  };

  for (const member of members) {
    const due = dues.get(String(member._id)) || { lateWeeks: [], fines: [] };
    const lateWeeks = includeLate ? due.lateWeeks : [];
    const fines = includeFines ? due.fines : [];

    if (!member.email) {
      skip(member, 'No email address on file');
      continue;
    }
    if (member.emailNotifications === false) {
      skip(member, 'Member has switched email reminders off');
      continue;
    }
    // Above the group's money line, the late weeks are not something he is written to about. This
    // is checked before "nothing outstanding", because a member over the line *does* have closed
    // weeks the engine counted (due.lateWeeksIgnored) — the row has to say which reason it was, or
    // the office reads "nothing outstanding" about a member whose page shows a week he missed.
    if (includeLate && due.coveredByBalance) {
      skippedByMoneyLimit += 1;
      skip(
        member,
        aboveLimitReason({
          moneyHeld: due.moneyHeld,
          limit: due.moneyLimit,
          weekNumber: due.weekNumber,
        })
      );
      continue;
    }
    if (lateWeeks.length === 0 && fines.length === 0 && !cleanNote) {
      skip(member, 'Nothing outstanding');
      continue;
    }

    // The weekly budget, checked after every reason that has nothing to do with it. The order
    // matters to whoever reads the row: "No email address on file" is a job for the office, while
    // "already emailed this week" is a limit somebody may deliberately override — so the reason
    // that has a fix comes first, and the two are never confused for each other.
    const sentBefore = sentThisWeek.get(String(member._id))?.count || 0;
    const allowance = allowanceFor(sentBefore, maxPerWeek);
    if (!ignoreWeeklyLimit && !allowance.allowed) {
      skippedByWeeklyLimit += 1;
      skip(member, overLimitReason(allowance));
      continue;
    }

    try {
      const { subject, html, text } = buildReminderEmail({
        chamaName: settings.chamaName,
        member,
        lateWeeks,
        fines,
        note: cleanNote,
      });
      await sendMail({ to: member.email, subject, html, text });
      sent += 1;
      results.push({
        id: member._id,
        name: member.name,
        email: member.email,
        status: 'sent',
        reason: null,
        // How many he has had this week including this one, so the screen can say "1 of 1" on
        // the row it just cleared rather than leaving the treasurer to count.
        remindersThisWeek: sentBefore + 1,
      });

      // Written down as it happens, because the response these belong to may never be
      // delivered — a request the office gives up on finishes nowhere and is logged
      // nowhere. Without this line, "were the emails sent?" had no answer on the server.
      logEvent('reminder_email_sent', { rid, memberId: String(member._id) });

      await logAudit({
        action: 'create',
        entityType: 'Notification',
        entityId: member._id,
        performedBy,
        after: {
          channel: 'email',
          // What makes this entry a reminder rather than a fine email, and therefore what the
          // weekly budget counts and the history screen lists (utils/reminderLog). Both fine
          // emails already carry their own kind, so the three are told apart from the entry
          // alone, with no second register to keep in step.
          kind: 'reminder',
          to: member.email,
          subject,
          lateWeeks: lateWeeks.length,
          fines: fines.length,
          note: cleanNote || null,
          // The week's running total, and the limit it was measured against — so the entry says
          // whether this was the first nudge of the week or a deliberate fourth, without anybody
          // having to count the entries around it.
          remindersThisWeek: sentBefore + 1,
          weeklyLimit: maxPerWeek,
          limitOverridden: ignoreWeeklyLimit || undefined,
        },
      });
    } catch (err) {
      failed += 1;
      results.push({
        id: member._id,
        name: member.name,
        email: member.email,
        status: 'failed',
        reason: err.message,
      });
      // The reason, with the provider's own code in it — 535 for a revoked app password,
      // 550 for an address it will not accept, ETIMEDOUT for a host that cannot reach the
      // port. Each is a different fix, and none of them is guessable from a screen that
      // only says the send did not finish.
      logEvent(
        'reminder_email_failed',
        { rid, memberId: String(member._id), error: describeMailError(err) },
        'error'
      );
    }
  }

  // The batch in one line: what went, and how long it honestly took. The duration is the
  // number that explains a screen complaining that the server took too long.
  logEvent('reminder_batch_done', {
    rid,
    attempted: members.length,
    sent,
    skipped,
    skippedByLimit: skippedByWeeklyLimit,
    failed,
    ms: Date.now() - startedAt,
  });

  return {
    sent,
    skipped,
    failed,
    // Named separately from the other skips: "already emailed this week" is the one reason a
    // person can decide to overrule, and a batch that quietly sent nothing because of it must
    // not look the same as a batch that found nobody to email.
    skippedByWeeklyLimit,
    // And separately again: a member left alone because he holds more than the group chases. The
    // office needs to be able to tell that from a failure, since nothing is wrong with him.
    skippedByMoneyLimit,
    results,
    weeklyLimit: maxPerWeek,
    weekStart,
  };
}

// POST /api/notifications/reminders — body:
// { memberIds: [...], includeLate: true, includeFines: true, note: '' }
// Sends sequentially and reports per member, so a single bad address can't
// abort the rest of the batch.
async function sendReminders(req, res, next) {
  try {
    // Refused before a single member is looked at, with the same sentence the senders
    // themselves use and marked as written for a person — so the screen shows it in
    // production instead of the generic "Something went wrong".
    assertMailConfigured();

    const {
      memberIds,
      includeLate = true,
      includeFines = true,
      note = '',
      // Whether this batch may go to members who are already at their weekly limit. Off unless
      // the screen says otherwise, and only ever true because a person ticked the box.
      ignoreWeeklyLimit = false,
    } = req.body || {};
    const ids = [...new Set((Array.isArray(memberIds) ? memberIds : []).map(String))].slice(
      0,
      MAX_RECIPIENTS
    );
    if (ids.length === 0) {
      return res.status(400).json({ message: 'Select at least one member' });
    }

    const members = await Member.find({ _id: { $in: ids }, active: true })
      .select('name phone email emailNotifications')
      .lean();

    const settings = await getOrCreateSettings();
    const dues = await computeMemberDues(members, { settings });

    const summary = await deliverReminders({
      members,
      dues,
      settings,
      includeLate,
      includeFines,
      note,
      performedBy: req.user._id,
      rid: req.id,
      ignoreWeeklyLimit: ignoreWeeklyLimit === true,
    });

    res.json({
      sent: summary.sent,
      skipped: summary.skipped,
      failed: summary.failed,
      // The one skip the caller can do something about, named on its own: the screen offers to
      // send anyway rather than leaving "skipped 4" to be interpreted.
      skippedByWeeklyLimit: summary.skippedByWeeklyLimit,
      // And the skip nobody can overrule from this screen: a member holding more than the group
      // chases is not told he is behind, at any batch size. Named so the row can explain itself.
      skippedByMoneyLimit: summary.skippedByMoneyLimit,
      weeklyLimit: summary.weeklyLimit,
      weekStart: summary.weekStart,
      results: summary.results,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  mailStatus,
  listReminders,
  sendReminders,
  reminderHistory,
  // Shared with the weekly sweep job, so a member emailed automatically and one emailed by
  // hand are told exactly the same thing.
  computeMemberDues,
  deliverReminders,
  MAX_RECIPIENTS,
};