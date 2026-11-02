// The treasurer's ledger controller, part: week. controllers/ledgerController.js is the index the routes use.

const Member = require('../../models/Member');
const Contribution = require('../../models/Contribution');
const { getOrCreateSettings } = require('../../utils/settings');
const { resolveConfig, currentWeekNumber, weekRange, parseEatDate, toEatDateString } = require('../../utils/weekCycle');
const { getLedgerTypes } = require('../../utils/ledgerTypes');
const { logAudit } = require('../../utils/auditLogger');
const { METHODS } = require('./logs');

// POST /api/ledger/collect-week — the one-time bulk entry for a week that was
// collected in cash, for every member at once. Week 91 is the case it exists for:
// the week the paper ledger closed just before go-live, where every member paid
// the week's 1,400 and the week's 100 tea, and the treasurer should not have to
// hand-enter 32 pairs of rows.
//
// Two rows per member — the weekly contribution and the tea. The tea is logged
// rather than derived because the automatic deduction only covers scored weeks: a
// week before the cycle opened has no automatic figure behind it, and the engine
// counts tea logged for those weeks as the deduction it was.
//
// Every row carries a deterministic clientRequestId, so running this twice posts
// nothing the second time and a dropped response cannot double a member up.
// `dryRun` reports exactly what it would do without writing anything.
async function collectWeek(req, res, next) {
  try {
    const { weekNumber, weeklyAmount, chaiAmount, method = 'cash', note, dryRun } = req.body || {};
    const settings = await getOrCreateSettings();
    const config = resolveConfig(settings);

    const week = parseInt(weekNumber, 10);
    if (!Number.isInteger(week) || week < 1) {
      return res.status(400).json({ message: 'Week must be a whole number of at least 1' });
    }
    if (week > currentWeekNumber(config)) {
      return res.status(400).json({ message: 'That week has not started yet' });
    }

    const weekly = Number(weeklyAmount);
    if (!Number.isFinite(weekly) || weekly <= 0) {
      return res.status(400).json({ message: 'The weekly amount must be greater than zero' });
    }
    const chai =
      chaiAmount === undefined || chaiAmount === null || chaiAmount === '' ? 0 : Number(chaiAmount);
    if (!Number.isFinite(chai) || chai < 0) {
      return res.status(400).json({ message: 'The tea amount cannot be negative' });
    }
    if (!METHODS.includes(method)) {
      return res.status(400).json({ message: `Method must be one of: ${METHODS.join(', ')}` });
    }

    const types = await getLedgerTypes();
    if (!types.weekly) {
      return res.status(400).json({ message: 'Ledger type missing — run the ledger setup again' });
    }
    if (chai > 0 && !types.chai) {
      return res.status(400).json({ message: 'Tea type missing — run the ledger setup again' });
    }

    // Dated on the Thursday the week closed, at midnight EAT, so the rows land in
    // the week they belong to on every screen rather than on today's date.
    const range = weekRange(week, config);
    const when = parseEatDate(toEatDateString(range.endDate));
    const text = String(note || '').trim() || `Week ${week} collection — posted in one go`;

    const members = await Member.find({ active: true }).sort({ name: 1 }).select('_id name').lean();
    const planned = members.map((member) => ({
      member,
      weeklyId: `week${week}-${member._id}-weekly`,
      chaiId: `week${week}-${member._id}-chai`,
    }));

    // Idempotency is per member, not per batch: a member already posted is left
    // alone, so a run that died halfway can simply be run again.
    const existing = await Contribution.find({
      clientRequestId: { $in: planned.flatMap((p) => [p.weeklyId, p.chaiId]) },
    })
      .select('clientRequestId')
      .lean();
    const already = new Set(existing.map((e) => e.clientRequestId));

    const toPost = planned.filter((p) => !already.has(p.weeklyId));
    const summary = {
      weekNumber: week,
      date: when,
      members: members.length,
      posted: toPost.length,
      skipped: members.length - toPost.length,
      perMember: { weekly, chai },
      totals: {
        weekly: toPost.length * weekly,
        chai: toPost.length * chai,
        cash: toPost.length * weekly + toPost.length * chai,
      },
    };

    if (dryRun) {
      return res.json({
        ...summary,
        dryRun: true,
        membersAffected: toPost.map((p) => p.member.name),
      });
    }

    for (const { member, weeklyId, chaiId } of toPost) {
      await Contribution.create({
        memberId: member._id,
        typeId: types.weekly._id,
        amount: weekly,
        date: when,
        method,
        note: text,
        loggedBy: req.user._id,
        clientRequestId: weeklyId,
      });
      if (chai > 0) {
        await Contribution.create({
          memberId: member._id,
          typeId: types.chai._id,
          amount: chai,
          date: when,
          method,
          note: text,
          loggedBy: req.user._id,
          clientRequestId: chaiId,
        });
      }
    }

    // One entry for the batch rather than 64 per-row entries: a group-wide
    // maintenance action belongs to the System entity, the same way a reset does,
    // and the summary carries the member ids and the totals so the trail is whole.
    await logAudit({
      action: 'create',
      entityType: 'System',
      entityId: settings._id,
      performedBy: req.user._id,
      after: { action: 'collect-week', ...summary, memberIds: toPost.map((p) => String(p.member._id)) },
    });

    res.status(201).json(summary);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/ledger/collect-week?weekNumber=91 — takes a bulk entry back out
// again, for when the week or the amounts were wrong. Soft delete, like every
// other record, so the rows keep their trail and a mistake is one call away
// instead of a manual repair.
async function undoCollectWeek(req, res, next) {
  try {
    const week = parseInt(req.query.weekNumber, 10);
    if (!Number.isInteger(week) || week < 1) {
      return res.status(400).json({ message: 'Week must be a whole number of at least 1' });
    }
    const settings = await getOrCreateSettings();
    const result = await Contribution.updateMany(
      { clientRequestId: new RegExp(`^week${week}-`), deleted: false },
      { $set: { deleted: true } }
    );
    await logAudit({
      action: 'delete',
      entityType: 'System',
      entityId: settings._id,
      performedBy: req.user._id,
      before: { action: 'undo-collect-week', weekNumber: week, removed: result.modifiedCount },
    });
    res.json({ weekNumber: week, removed: result.modifiedCount });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  collectWeek,
  undoCollectWeek,
};
