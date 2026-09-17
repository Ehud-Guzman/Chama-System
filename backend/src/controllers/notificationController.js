const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const Fine = require('../models/Fine');
const { getOrCreateSettings } = require('../utils/settings');
const { buildWeeklySchedule } = require('../utils/weeklySchedule');
const { isMailConfigured, sendMail, buildReminderEmail } = require('../utils/mailer');
const { logAudit } = require('../utils/auditLogger');

// One request should never try to email the whole group and then time out — the
// page selects a handful at a time.
const MAX_RECIPIENTS = 200;

// Works out exactly what a set of members still owes: unpaid weekly
// contribution weeks and unpaid fines. This is the same maths the member's own
// passbook shows (buildWeeklySchedule), so an email can never claim something
// the member's own statement contradicts.
async function computeMemberDues(members) {
  const ids = members.map((m) => m._id);
  if (ids.length === 0) return new Map();

  const [weeklyTypes, settings, contributions, pendingFines] = await Promise.all([
    // Group-fund weekly types (Chai) are a flat group deduction, never a member's
    // personal debt — same exclusion weeklyReconciliation makes.
    ContributionType.find({ isWeekly: true, isGroupFund: false, active: true })
      .select('name weeklyAmount')
      .lean(),
    getOrCreateSettings(),
    Contribution.find({ memberId: { $in: ids }, deleted: false })
      .select('memberId typeId amount grossAmount date')
      .lean(),
    Fine.find({ memberId: { $in: ids }, deleted: false, remaining: { $gt: 0 } })
      .populate('typeId', 'name')
      .lean(),
  ]);

  // Weeks before the group started tracking are unreconcilable history (usually
  // a paper ledger imported as one cumulative snapshot) — emailing members about
  // them would be both wrong and, understandably, infuriating.
  const trackingStart = settings.weeklyTrackingStartDate
    ? new Date(settings.weeklyTrackingStartDate).getTime()
    : 0;

  const dues = new Map();

  for (const member of members) {
    const lateWeeks = [];

    for (const type of weeklyTypes) {
      const typeContributions = contributions.filter(
        (c) => String(c.memberId) === String(member._id) && String(c.typeId) === String(type._id)
      );
      const weeks = buildWeeklySchedule(member.joinDate, type.weeklyAmount, typeContributions);

      for (const week of weeks) {
        // The week in progress isn't late yet — a member still has until it ends.
        if (week.isCurrent) continue;
        if (trackingStart && week.startDate.getTime() < trackingStart) continue;
        if (week.status === 'paid') continue;
        lateWeeks.push({
          weekNumber: week.weekNumber,
          startDate: week.startDate,
          typeName: type.name,
          expected: week.expected,
          paid: week.paid,
          shortfall: Math.max(week.expected - week.paid, 0),
        });
      }
    }

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
async function mailStatus(req, res) {
  res.json({
    configured: isMailConfigured(),
    from: isMailConfigured() ? process.env.MAIL_FROM : null,
  });
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
      configured: isMailConfigured(),
      from: isMailConfigured() ? process.env.MAIL_FROM : null,
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

// POST /api/notifications/reminders — body:
// { memberIds: [...], includeLate: true, includeFines: true, note: '' }
// Sends sequentially and reports per member, so a single bad address can't
// abort the rest of the batch.
async function sendReminders(req, res, next) {
  try {
    if (!isMailConfigured()) {
      const err = new Error(
        'Email sending is not set up yet. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM to the server environment.'
      );
      err.status = 503;
      throw err;
    }

    const { memberIds, includeLate = true, includeFines = true, note = '' } = req.body || {};
    const ids = [...new Set((Array.isArray(memberIds) ? memberIds : []).map(String))].slice(
      0,
      MAX_RECIPIENTS
    );
    if (ids.length === 0) {
      return res.status(400).json({ message: 'Select at least one member' });
    }

    const members = await Member.find({ _id: { $in: ids }, active: true })
      .select('name phone email emailNotifications joinDate')
      .lean();

    const [dues, settings] = await Promise.all([
      computeMemberDues(members),
      getOrCreateSettings(),
    ]);

    const cleanNote = String(note || '').trim().slice(0, 600);
    const results = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;

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

        await logAudit({
          action: 'create',
          entityType: 'Notification',
          entityId: member._id,
          performedBy: req.user._id,
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
      }
    }

    res.json({ sent, skipped, failed, results });
  } catch (err) {
    next(err);
  }
}

module.exports = { mailStatus, listReminders, sendReminders };