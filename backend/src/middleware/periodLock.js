const Contribution = require('../models/Contribution');
const Expense = require('../models/Expense');
const Fine = require('../models/Fine');
const { getOrCreateSettings } = require('../utils/settings');
const { resolveConfig, weekRange, parseEatDate, toEatDateString, DAY_MS } = require('../utils/weekCycle');
const { overrideReason } = require('../utils/overrides');
const { logAudit } = require('../utils/auditLogger');

// Closed books.
//
// When the committee closes a period (Control Room → Close the books), money dated on or before
// that day can no longer be added, changed or removed by the office. The point is the one every
// treasurer wants and no screen gave them: last month's figures, once agreed, stay agreed.
//
// The check sits in front of the controller rather than inside it, for the same reason the role
// check does — one rule, enforced in one place, so a new money route is protected by naming this
// middleware rather than by remembering to.
//
// The super admin may pass with a written reason (utils/overrides). That pass is recorded in the
// audit trail as its own entry, before the change it allowed, so the trail reads "super admin
// opened the period because …" and then the edit.

// The first instant AFTER the locked day: anything strictly before it is locked.
function lockedBefore(settings) {
  if (!settings?.lockedThrough) return null;
  const day = parseEatDate(toEatDateString(settings.lockedThrough));
  return day.getTime() + DAY_MS;
}

function validDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Where the dates a request touches come from. Each returns the dates the change would land on —
// the new one and, for an edit or a removal, the one already on the record.
const SOURCES = {
  // A new row, dated by the body or by today.
  body: async (req) => [validDate(req.body?.date) || new Date()],
  // An edit or removal of an existing row: where it is now, and where it is going.
  contribution: async (req) => [
    (await Contribution.findById(req.params.id).select('date').lean())?.date,
    validDate(req.body?.date),
  ],
  expense: async (req) => [
    (await Expense.findById(req.params.id).select('date').lean())?.date,
    validDate(req.body?.date),
  ],
  fine: async (req) => [(await Fine.findById(req.params.id).select('date').lean())?.date],
  // A whole week at once: the ledger dates a week's rows on the day it closed.
  week: async (req, settings) => {
    if (req.body?.dryRun) return [];
    const week = parseInt(req.body?.weekNumber ?? req.query?.weekNumber, 10);
    if (!Number.isInteger(week) || week < 1) return [];
    return [weekRange(week, resolveConfig(settings)).endDate];
  },
};

function periodLock(source = 'body') {
  const datesFor = SOURCES[source];
  if (!datesFor) throw new Error(`periodLock: unknown source "${source}"`);

  return async function periodLockMiddleware(req, res, next) {
    try {
      const settings = await getOrCreateSettings();
      const limit = lockedBefore(settings);
      if (limit === null) return next();

      // An id that is not an id is the controller's 400 or 404 to give, not this middleware's.
      let found;
      try {
        found = await datesFor(req, settings);
      } catch (err) {
        if (err.name === 'CastError') return next();
        throw err;
      }
      const dates = found.map(validDate).filter(Boolean);
      const hit = dates.find((d) => d.getTime() < limit);
      if (!hit) return next();

      const reason = overrideReason(req);
      const lockedThrough = toEatDateString(settings.lockedThrough);
      if (!reason) {
        const isSuper = req.user?.role === 'super_admin' && !req.previewing;
        return res.status(423).json({
          message:
            `The books are closed up to ${lockedThrough}` +
            (settings.lockReason ? ` (${settings.lockReason})` : '') +
            '. ' +
            (isSuper
              ? 'Give a reason to go through it.'
              : 'Only the super admin can change money dated before then.'),
          code: 'period_locked',
          lockedThrough,
          canOverride: isSuper,
        });
      }

      await logAudit({
        action: 'update',
        entityType: 'System',
        entityId: settings._id,
        performedBy: req.user._id,
        after: {
          action: 'period-lock-override',
          reason,
          lockedThrough,
          method: req.method,
          path: String(req.originalUrl || '').split('?')[0],
          touchedDate: toEatDateString(hit),
        },
      });
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { periodLock, lockedBefore };
