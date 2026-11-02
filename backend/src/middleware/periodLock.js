const Contribution = require('../models/Contribution');
const Expense = require('../models/Expense');
const Fine = require('../models/Fine');
const Loan = require('../models/Loan');
const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const mongoose = require('mongoose');
const { getOrCreateSettings } = require('../utils/settings');
const { readAmount } = require('../utils/money');
const {
  resolveConfig,
  weekRange,
  fridayOf,
  parseEatDate,
  toEatDateString,
  DAY_MS,
} = require('../utils/weekCycle');
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
  // A loan repayment is dated by its own date, and taking the last one back or cancelling a loan
  // changes money on the day it was made.
  loan: async (req) => [(await Loan.findById(req.params.id).select('issuedAt').lean())?.issuedAt],
  loanLastRepayment: async (req) => {
    const loan = await Loan.findById(req.params.id).select('repayments').lean();
    return [loan?.repayments?.length ? loan.repayments[loan.repayments.length - 1].date : null];
  },
  // Taking back a fine payment changes money on the day that payment was made.
  finePayment: async (req) => {
    const fine = await Fine.findById(req.params.id).select('settlements').lean();
    const index = Number.parseInt(req.params.index, 10);
    return [Number.isInteger(index) ? fine?.settlements?.[index]?.date : null];
  },
  // The week cycle and the opening balances. Not dated money — but every figure in a closed period is
  // worked out from them, so changing one rewrites the period the committee agreed. A real change is
  // treated as touching the last closed day; saving the screen with nothing altered is not.
  setup: async (req, settings) => (await setupWouldChange(req.body || {}, settings) ? [new Date(lockedBefore(settings) - 1)] : []),
  // A whole week at once: the ledger dates a week's rows on the day it closed.
  week: async (req, settings) => {
    if (req.body?.dryRun) return [];
    const week = parseInt(req.body?.weekNumber ?? req.query?.weekNumber, 10);
    if (!Number.isInteger(week) || week < 1) return [];
    return [weekRange(week, resolveConfig(settings)).endDate];
  },
};

// Whether a save of the finance setup screen would actually change a figure. The screen sends every
// box back on every save, so "the body carries a balance" is not the question — "it differs from what
// is stored" is. Unreadable values are the controller's 400 to give, not a change.
async function setupWouldChange(body, settings) {
  const differs = (value, current) => {
    const read = readAmount(value);
    return read.amount !== undefined && read.amount !== (Number(current) || 0);
  };
  if (differs(body.weeklyAmount, settings.weeklyAmount)) return true;
  if (differs(body.chaiAmount, settings.chaiAmount)) return true;
  if (body.cycleStartWeek !== undefined && body.cycleStartWeek !== null && body.cycleStartWeek !== '') {
    const week = parseInt(body.cycleStartWeek, 10);
    if (Number.isInteger(week) && week !== settings.cycleStartWeek) return true;
  }
  if (body.weekAnchorDate) {
    const anchor = fridayOf(parseEatDate(body.weekAnchorDate)).getTime();
    if (!Number.isNaN(anchor) && anchor !== new Date(settings.weekAnchorDate).getTime()) return true;
  }

  const rowsOf = (list, idKey) =>
    (Array.isArray(list) ? list : []).filter((row) => row && mongoose.Types.ObjectId.isValid(row[idKey]));
  const members = rowsOf(body.balances, 'memberId');
  if (members.length) {
    const current = await Member.find({ _id: { $in: members.map((r) => r.memberId) } })
      .select('openingBalance')
      .lean();
    const byId = new Map(current.map((m) => [String(m._id), m.openingBalance]));
    if (members.some((r) => byId.has(String(r.memberId)) && differs(r.openingBalance, byId.get(String(r.memberId))))) {
      return true;
    }
  }
  const funds = rowsOf(body.funds, 'typeId');
  if (funds.length) {
    const current = await ContributionType.find({ _id: { $in: funds.map((r) => r.typeId) } })
      .select('openingBalance')
      .lean();
    const byId = new Map(current.map((t) => [String(t._id), t.openingBalance]));
    if (funds.some((r) => byId.has(String(r.typeId)) && differs(r.openingBalance, byId.get(String(r.typeId))))) {
      return true;
    }
  }
  return false;
}

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
