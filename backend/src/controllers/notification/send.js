// The reminders controller, part: send. controllers/notificationController.js is the index the routes use.

const Member = require('../../models/Member');
const { normaliseMaxPerWeek, weekWindow, sendsSince, allowanceFor, overLimitReason } = require('../../utils/reminderLog');
const { verifyMail, describeMailError, mailFailure, buildReminderEmail, sendMail, assertMailConfigured } = require('../../utils/mailer');
const { logEvent } = require('../../middleware/requestLogger');
const { aboveLimitReason } = require('../../utils/reminderLimit');
const { logAudit } = require('../../utils/auditLogger');
const { getOrCreateSettings } = require('../../utils/settings');
const { MAX_RECIPIENTS, computeMemberDues } = require('./dues');

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

    // The super admin's switch. Said in words written for a person, before anything is looked up.
    if ((await getOrCreateSettings()).reminderEmailsEnabled === false) {
      return res.status(403).json({
        message: 'Reminder emails have been switched off by the super admin (Control Room → Switches).',
      });
    }

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
      // openingBalance for the same reason as the list's query: it is what the money line measures
      // a member against, and a batch that skipped the members who are ahead must not be the one
      // place that reads them as holding nothing.
      .select('name phone email emailNotifications openingBalance fineDebits')
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
  deliverReminders,
  sendReminders,
};
