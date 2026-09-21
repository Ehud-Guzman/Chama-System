const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const Fine = require('../models/Fine');
const { getOrCreateSettings } = require('../utils/settings');
const { resolveConfig } = require('../utils/weekCycle');
const { WEEKLY_TYPE_NAME, bucketForType } = require('../utils/ledgerTypes');
const { computeMemberLedger } = require('../utils/memberLedger');
const {
  assertMailConfigured,
  describeMailConfig,
  describeMailError,
  sendMail,
  verifyMail,
  buildReminderEmail,
  buildTestEmail,
} = require('../utils/mailer');
const { logAudit } = require('../utils/auditLogger');
// The request log is where "emails are not being sent" gets its evidence: a request the
// office gives up on leaves no line of its own (only a finished response is logged), so
// the outcome of every send has to be written down as it happens, not only returned in
// a response somebody may never see.
const { logEvent } = require('../middleware/requestLogger');

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
async function computeMemberDues(members) {
  const ids = members.map((m) => m._id);
  if (ids.length === 0) return new Map();

  const [types, settings, contributions, pendingFines] = await Promise.all([
    ContributionType.find().select('name isGroupFund isWeekly').lean(),
    getOrCreateSettings(),
    Contribution.find({ memberId: { $in: ids }, deleted: false })
      .select('memberId typeId amount grossAmount date')
      .lean(),
    Fine.find({ memberId: { $in: ids }, deleted: false, remaining: { $gt: 0 } })
      .populate('typeId', 'name')
      .lean(),
  ]);

  const config = resolveConfig(settings);
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

    dues.set(String(member._id), {
      lateWeeks: lateWeeks.sort((a, b) => a.weekNumber - b.weekNumber),
      fines,
      finesTotal,
      lateTotal,
      total: finesTotal + lateTotal,
    });
  }

  return dues;
}

// GET /api/notifications/status — is this deployment able to send at all?
//
// `configured` is about the variables, not about reachability: a host that has the
// SMTP_* values and cannot open the connection reports itself configured and still
// sends nothing. The honest test is the test button (POST /api/notifications/test),
// which opens a connection and signs in.
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

    const dues = await computeMemberDues(members);

    const rows = members.map((m) => {
      const due = dues.get(String(m._id)) || { lateWeeks: [], fines: [], finesTotal: 0, lateTotal: 0, total: 0 };
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
      };
    });

    const visible = rows.filter((r) => !onlyOwing || r.total > 0);
    visible.sort((a, b) => b.total - a.total);

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
}) {
  const cleanNote = String(note || '').trim().slice(0, 600);
  const results = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const startedAt = Date.now();

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
    throw err;
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
    if (lateWeeks.length === 0 && fines.length === 0 && !cleanNote) {
      skip(member, 'Nothing outstanding');
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
      results.push({ id: member._id, name: member.name, email: member.email, status: 'sent', reason: null });

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
          to: member.email,
          subject,
          lateWeeks: lateWeeks.length,
          fines: fines.length,
          note: cleanNote || null,
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
    failed,
    ms: Date.now() - startedAt,
  });

  return { sent, skipped, failed, results };
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

    const { memberIds, includeLate = true, includeFines = true, note = '' } = req.body || {};
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

    const [dues, settings] = await Promise.all([computeMemberDues(members), getOrCreateSettings()]);

    const summary = await deliverReminders({
      members,
      dues,
      settings,
      includeLate,
      includeFines,
      note,
      performedBy: req.user._id,
      rid: req.id,
    });

    res.json({
      sent: summary.sent,
      skipped: summary.skipped,
      failed: summary.failed,
      results: summary.results,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/notifications/test — one message, to the address on the signed-in account.
//
// This is the check that answers the question the office actually asks — "is it sending
// at all?" — without a member being involved, and it is the only place an SMTP error is
// worth showing exactly as the provider worded it: whoever presses the button is the
// person who can change the server's environment. A reminder that fails says nothing to
// anybody; this one says why.
async function sendTestEmail(req, res, next) {
  try {
    assertMailConfigured();

    const to = String(req.user.email || '').trim();
    if (!to) {
      const err = new Error('Your account has no email address, so there is nowhere to send a test.');
      err.status = 400;
      throw err;
    }

    const settings = await getOrCreateSettings();
    const { subject, text, html } = buildTestEmail({ chamaName: settings.chamaName });

    let info;
    try {
      info = await sendMail({ to, subject, text, html });
    } catch (err) {
      // A rejection carries a status only when it was written for a person (nothing
      // configured); anything else is the provider's own answer, and that is what the
      // person pressing this button needs to read. 535 names a revoked app password,
      // ETIMEDOUT names a host that cannot reach the port at all — different fixes.
      if (err.status) throw err;
      const refused = new Error(`The mail server refused the test: ${describeMailError(err)}`);
      refused.status = 503;
      refused.expose = true;
      throw refused;
    }

    logEvent('test_email_sent', { rid: req.id, userId: String(req.user._id), to });
    res.json({
      sent: true,
      to,
      from: process.env.MAIL_FROM || null,
      messageId: (info && info.messageId) || null,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  mailStatus,
  listReminders,
  sendReminders,
  // The office's own check, exported alongside the rest so the route file reads as the
  // list of things this controller can do.
  sendTestEmail,
  // Shared with the weekly sweep job, so a member emailed automatically and one emailed by
  // hand are told exactly the same thing.
  computeMemberDues,
  deliverReminders,
  MAX_RECIPIENTS,
};