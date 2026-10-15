const Fine = require('../models/Fine');
const { isAfterToday } = require('../utils/futureDate');
const Member = require('../models/Member');
const FineType = require('../models/FineType');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { getOrCreateSettings } = require('../utils/settings');
const { readMoney } = require('../utils/money');
const { sendWorkbook } = require('../utils/xlsxExport');
// The member is told as the fine is written, and told again when he pays it. Neither
// send can fail this request: utils/fineEmails catches everything and writes the
// outcome to the request log.
const { announceFineIssued, announceFinesPaid } = require('../utils/fineEmails');
const { buildFineReport, renderFineReportPdf, fineReportSheets,
  buildFineGroupReport, renderFineGroupReportPdf, fineGroupReportSheets,
} = require('../utils/fineReport');
const mongoose = require('mongoose');
const { withOptionalTransaction } = require('../utils/fineAllocation');
const { memberLedgerNow } = require('../utils/memberMoney');
const {
  FinePaymentError,
  readSource,
  recordFinePayment,
  reverseFinePayment,
  releaseFineDebits,
  listUnreviewedPayments,
  reviewFinePayment,
} = require('../utils/fineSettlement');

// The disciplinary officer works in his own world: he issues conduct fines and has
// no business reading the treasurer's. So every read he makes is narrowed to
// disciplinary-category types — the same boundary createFine already enforces when
// he issues one — and his exports say so on the page.
async function scopeForUser(user) {
  if (user.role !== 'disciplinary') return { isScoped: false, filter: {}, scopeLabel: 'All fines' };

  const typeIds = await FineType.distinct('_id', { category: 'disciplinary' });
  return {
    isScoped: true,
    filter: { typeId: { $in: typeIds } },
    scopeLabel: 'Disciplinary fines',
  };
}

// The totals a screen or a report shows above the list.
function summariseFines(fines) {
  const issued = fines.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
  const outstanding = fines.reduce((sum, f) => sum + (Number(f.remaining) || 0), 0);
  return {
    count: fines.length,
    issued,
    outstanding,
    cleared: issued - outstanding,
    pendingCount: fines.filter((f) => Number(f.remaining) > 0).length,
    clearedCount: fines.filter((f) => Number(f.remaining) <= 0).length,
  };
}

function toFineJson(fine) {
  return {
    id: fine._id,
    date: fine.date,
    amount: fine.amount,
    remaining: fine.remaining,
    reason: fine.reason || '',
    status: Number(fine.remaining) > 0 ? 'pending' : 'settled',
    type: fine.typeId?.name || null,
    category: fine.typeId?.category || null,
    memberId: fine.memberId?._id || fine.memberId,
    memberName: fine.memberId?.name || null,
    memberRegNumber: fine.memberId?.regNumber || null,
    issuedBy: fine.issuedBy?.name || null,
    voided: fine.deleted === true,
    // What has been paid against it, oldest first, so the screen can show the history under the
    // fine and offer to undo a payment keyed in by mistake. `index` is the payment's place on the
    // fine, which is how an undo names it. `source` says how it was paid: taken from his balance,
    // cash he handed over, out of a contribution, or null for a payment recorded before the
    // office was asked (those are listed under "Past payments to check").
    payments: (fine.settlements || []).map((s, index) => ({
      index,
      amount: s.amount,
      date: s.date,
      source: s.source || (s.contributionId ? 'contribution' : null),
    })),
  };
}

// GET /api/fines?memberId=&status=pending|settled|voided&page=&limit=
// Admin sees every fine; the disciplinary officer sees his own category only.
async function listFines(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const scope = await scopeForUser(req.user);
    const filter = { ...scope.filter, deleted: req.query.status === 'voided' };
    if (req.query.memberId) filter.memberId = req.query.memberId;
    // Find a member's fines by typing a bit of his name, phone or registration number — the way
    // the office looks somebody up at a meeting.
    const search = String(req.query.search || '').trim().slice(0, 60);
    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const ids = await Member.find({ $or: [{ name: pattern }, { phone: pattern }, { regNumber: pattern }] })
        .select('_id')
        .limit(200)
        .lean();
      filter.memberId = filter.memberId
        ? { $in: ids.map((m) => m._id).filter((id) => String(id) === String(filter.memberId)) }
        : { $in: ids.map((m) => m._id) };
    }
    if (req.query.status === 'pending') filter.remaining = { $gt: 0 };
    if (req.query.status === 'settled') filter.remaining = { $lte: 0 };

    const [fines, total, all] = await Promise.all([
      Fine.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('memberId', 'name phone regNumber')
        .populate('typeId', 'name category')
        .populate('issuedBy', 'name')
        .lean(),
      Fine.countDocuments(filter),
      // The summary is over every fine in scope, not just this page: a screen that
      // totalled only the rows it happened to load would under-report the debt.
      Fine.find({ ...scope.filter, deleted: false })
        .select('amount remaining')
        .lean(),
    ]);

    res.json({
      fines: fines.map(toFineJson),
      summary: summariseFines(all),
      scopeLabel: scope.scopeLabel,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/fines/member/:memberId/export?format=pdf|xlsx — ADMIN & DISCIPLINARY.
// One member's whole fine record: issued, paid off, outstanding, and what was
// voided. The disciplinary officer asked for this so he can hand a member (or a
// meeting) a proper document instead of reading a screen aloud.
async function exportMemberFines(req, res, next) {
  try {
    const member = await Member.findById(req.params.memberId).lean();
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const scope = await scopeForUser(req.user);
    const [fines, voidedFines, settings] = await Promise.all([
      Fine.find({ ...scope.filter, memberId: member._id, deleted: false })
        .sort({ date: -1, createdAt: -1 })
        .populate('typeId', 'name category')
        .populate('issuedBy', 'name')
        .lean(),
      Fine.find({ ...scope.filter, memberId: member._id, deleted: true })
        .sort({ date: -1 })
        .populate('typeId', 'name category')
        .populate('issuedBy', 'name')
        .lean(),
      getOrCreateSettings(),
    ]);

    const report = buildFineReport({
      member,
      fines,
      voidedFines,
      scopeLabel: scope.scopeLabel,
    });

    const slug = (member.regNumber || member.name || 'member').replace(/[^a-z0-9]+/gi, '-');
    const format = String(req.query.format || 'pdf').toLowerCase();

    if (format === 'xlsx' || format === 'excel') {
      return sendWorkbook(res, `fines-${slug}.xlsx`, fineReportSheets(report, settings.chamaName));
    }

    return renderFineReportPdf(res, report, settings.chamaName);
  } catch (err) {
    next(err);
  }
}

// POST /api/fines
async function createFine(req, res, next) {
  try {
    const { memberId, typeId, amount, reason, date } = req.body || {};

    const [member, type] = await Promise.all([
      Member.findById(memberId),
      FineType.findById(typeId),
    ]);
    if (!member || !member.active) {
      return res.status(400).json({ message: 'Member not found or inactive' });
    }
    if (!type || !type.active) {
      return res.status(400).json({ message: 'Fine type not found or inactive' });
    }
    // The disciplinary role only ever issues disciplinary-category fines —
    // financial fine types stay with the treasurer/admin.
    if (req.user.role === 'disciplinary' && type.category !== 'disciplinary') {
      return res.status(403).json({ message: 'You can only issue disciplinary fine types' });
    }
    const n = Number(amount) > 0 ? Number(amount) : type.defaultAmount;
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ message: 'Amount must be a number greater than zero' });
    }

    const fine = await Fine.create({
      memberId: member._id,
      typeId: type._id,
      amount: n,
      remaining: n,
      reason: String(reason || '').trim(),
      date: date ? new Date(date) : new Date(),
      issuedBy: req.user._id,
    });

    await logAudit({
      action: 'create',
      entityType: 'Fine',
      entityId: fine._id,
      performedBy: req.user._id,
      after: snapshot(fine),
    });

    const populated = await Fine.findById(fine._id)
      .populate('memberId', 'name phone regNumber')
      .populate('typeId', 'name')
      .lean();

    // The member is told his own fine exists, as it is written rather than at the next
    // meeting. Not awaited on purpose: recording a fine must not depend on a mail
    // server answering in time, and the send's outcome goes to the request log.
    announceFineIssued({ fine: populated, member, performedBy: req.user._id, rid: req.id });

    res.status(201).json({ fine: populated });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------------------------
// Paying fines
// ---------------------------------------------------------------------------------------------
//
// Every payment says how it was made, because the two ways move different money
// (utils/fineSettlement): taken out of the member's balance, which comes off what the group holds
// for him, or paid in cash on the side, which does not. A payment that does not say is refused
// with a sentence the office can act on rather than guessed at — a guess here is a member's
// balance wrong by the fine, or a fine marked paid by money that never arrived.

const money = (n) => `Ksh ${Number(n || 0).toLocaleString('en-KE')}`;

const SAY_HOW =
  'Say how this was paid: taken out of his balance, or paid in cash / M-Pesa. ' +
  'If this screen was already open, refresh the page and try again.';

// The day the money actually changed hands, which is not always the day it is keyed in — cash
// handed over at a meeting is often recorded days later, and the fine's own record is what the
// disciplinary report prints. Nothing from the future.
function readPaidAt(value) {
  if (!value) return { paidAt: new Date() };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { error: 'Invalid date' };
  if (isAfterToday(parsed)) return { error: 'Date cannot be in the future' };
  return { paidAt: parsed };
}

// The key the screen attached to a payment, or null. Anything that is not a short plain string is
// ignored rather than trusted.
function readRequestId(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  return key && key.length <= 100 && /^[\w.:-]+$/.test(key) ? key : null;
}

function respondPaymentError(err, res, next) {
  if (err instanceof FinePaymentError) return res.status(err.status).json({ message: err.message });
  return next(err);
}

// Everything that follows a payment that has already been written: one audit entry per fine, and
// one email naming what was received. Neither can fail the request — the payment is recorded.
async function afterPayment({ result, req, paidAt }) {
  // A retry of a payment that is already recorded has nothing more to audit or email: both were
  // done the first time.
  if (result.replay) return;
  const { applied, source, heldBefore, heldAfter, totalApplied, member } = result;

  for (const { fine, before, applied: part } of applied) {
    const after = snapshot(fine);
    await logAudit({
      action: 'update',
      entityType: 'Fine',
      entityId: fine._id,
      performedBy: req.user._id,
      before,
      // The audit entry names what the payment did to his balance, so the trail answers "why did
      // his money drop on that day?" without anybody re-deriving it.
      after:
        source === 'balance'
          ? { ...after, paidFromBalance: { amount: part, heldBefore, heldAfter } }
          : { ...after, paidInCash: { amount: part } },
    });
  }

  if (totalApplied > 0) {
    // Not awaited: the settlement is already written and audited, and a slow mail server must not
    // hold up the office's screen.
    Member.findById(member._id)
      .select('name email emailNotifications')
      .lean()
      .then((fresh) =>
        announceFinesPaid({
          payments: applied.map(({ fine, applied: part }) => ({
            label: fine.reason || fine.typeId?.name || 'Fine',
            amount: part,
            remaining: fine.remaining,
          })),
          member: fresh,
          totalPaid: totalApplied,
          paidAt,
          note:
            source === 'balance'
              ? `${money(totalApplied)} was taken from the balance the group holds for you. You now hold ${money(heldAfter)}.`
              : '',
          performedBy: req.user._id,
          rid: req.id,
        })
      )
      .catch(() => {
        // Nothing to do about a failure to read the member here: the payment is recorded either
        // way, and the log line the send would have written is replaced by nothing at all rather
        // than by a broken request.
      });
  }
}

async function paymentResponse(result) {
  await Promise.all(
    result.applied.map(({ fine }) =>
      fine.populate([
        { path: 'typeId', select: 'name category' },
        { path: 'memberId', select: 'name regNumber' },
      ])
    )
  );
  return {
    fines: result.applied.map(({ fine }) => toFineJson(fine)),
    // The first one, for callers that settled a single fine and read `fine`.
    fine: toFineJson(result.applied[0].fine),
    totalApplied: result.totalApplied,
    source: result.source,
    // True when this answer is a payment that was already recorded, not a new one.
    replay: Boolean(result.replay),
    // What it did to his balance: null for a cash payment, which does not touch it.
    held: result.source === 'balance' ? { before: result.heldBefore, after: result.heldAfter } : null,
  };
}

// POST /api/fines/:id/settle — one payment against one fine, by hand.
// Body: { amount, source: 'balance' | 'cash', date? }
async function settleFine(req, res, next) {
  try {
    const source = readSource(req.body?.source);
    if (!source) return res.status(400).json({ message: SAY_HOW });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: 'Fine not found' });
    }
    const fine = await Fine.findById(req.params.id).select('memberId deleted remaining').lean();
    if (!fine || fine.deleted) return res.status(404).json({ message: 'Fine not found' });
    if (fine.remaining <= 0) return res.status(400).json({ message: 'Fine is already settled' });

    const read = readMoney(req.body?.amount, { min: 0.01, label: 'Amount' });
    if (read.error) return res.status(400).json({ message: read.error });
    const when = readPaidAt(req.body?.date);
    if (when.error) return res.status(400).json({ message: when.error });

    const result = await recordFinePayment({
      memberId: fine.memberId,
      fineId: fine._id,
      amount: read.value,
      source,
      paidAt: when.paidAt,
      userId: req.user._id,
      requestId: readRequestId(req.body?.clientRequestId),
    });
    await afterPayment({ result, req, paidAt: when.paidAt });
    res.json(await paymentResponse(result));
  } catch (err) {
    respondPaymentError(err, res, next);
  }
}

// POST /api/fines/member/:memberId/pay — a payment from one member against one named fine. Each
// payment is for a single fine; nothing is spread over several.
// Body: { amount, source: 'balance' | 'cash', fineId, date? }
async function payMemberFines(req, res, next) {
  try {
    const source = readSource(req.body?.source);
    if (!source) return res.status(400).json({ message: SAY_HOW });
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId)) {
      return res.status(404).json({ message: 'Member not found' });
    }
    const fineId = req.body?.fineId || null;
    if (!fineId) return res.status(400).json({ message: 'Choose which fine is being paid' });
    if (!mongoose.Types.ObjectId.isValid(fineId)) {
      return res.status(404).json({ message: 'Fine not found' });
    }
    const read = readMoney(req.body?.amount, { min: 0.01, label: 'Amount' });
    if (read.error) return res.status(400).json({ message: read.error });
    const when = readPaidAt(req.body?.date);
    if (when.error) return res.status(400).json({ message: when.error });

    const result = await recordFinePayment({
      memberId: req.params.memberId,
      fineId,
      amount: read.value,
      source,
      paidAt: when.paidAt,
      userId: req.user._id,
      requestId: readRequestId(req.body?.clientRequestId),
    });
    await afterPayment({ result, req, paidAt: when.paidAt });
    res.json(await paymentResponse(result));
  } catch (err) {
    respondPaymentError(err, res, next);
  }
}

// GET /api/fines/member/:memberId/position — what the payment screen needs about one member: what
// the group holds for him (the most that can be taken from his balance), and the fines he still
// owes, oldest first, so he can choose the one being paid.
async function memberFinePosition(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId)) {
      return res.status(404).json({ message: 'Member not found' });
    }
    const member = await Member.findById(req.params.memberId)
      .select('name phone email emailNotifications regNumber active')
      .lean();
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const [ledger, fines] = await Promise.all([
      memberLedgerNow(member._id),
      Fine.find({ memberId: member._id, deleted: false, remaining: { $gt: 0 } })
        .sort({ date: 1, createdAt: 1 })
        .populate('typeId', 'name category')
        .lean(),
    ]);

    const owed = fines.reduce((sum, f) => sum + (Number(f.remaining) || 0), 0);
    const memberRef = { _id: member._id, name: member.name, regNumber: member.regNumber };
    res.json({
      member: {
        _id: member._id,
        name: member.name,
        phone: member.phone,
        regNumber: member.regNumber || null,
        active: member.active !== false,
        // Whether an email can reach him at all: an address on file and notifications left on. A member
        // who cannot be emailed is told some other way, and the screen offers one.
        canEmail: Boolean(String(member.email || '').trim()) && member.emailNotifications !== false,
      },
      // What the group holds for him — never negative as an offer: a member who holds nothing
      // simply cannot have a fine taken from his balance.
      held: Math.max(0, Math.round((Number(ledger?.money) || 0) * 100) / 100),
      owed: Math.round(owed * 100) / 100,
      fines: fines.map((f) => toFineJson({ ...f, memberId: memberRef })),
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/fines/:id/payments/:index/undo — takes back a payment keyed in by mistake. The fine is
// owed again by that amount and, if it had come out of his balance, the money goes back to him.
// Body: { amount } — the amount the office was looking at, so a stale screen cannot undo the wrong
// payment.
async function undoFinePayment(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: 'Fine not found' });
    }
    const index = Number.parseInt(req.params.index, 10);
    if (!Number.isInteger(index) || index < 0) {
      return res.status(404).json({ message: 'That payment is no longer on the fine' });
    }
    const expected = req.body?.amount === undefined ? undefined : Number(req.body.amount);

    const result = await reverseFinePayment({ fineId: req.params.id, index, expected });
    await logAudit({
      action: 'update',
      entityType: 'Fine',
      entityId: result.fine._id,
      performedBy: req.user._id,
      before: result.before,
      after: {
        ...snapshot(result.fine),
        paymentUndone: { amount: result.amount, source: result.source },
      },
    });

    await result.fine.populate([
      { path: 'typeId', select: 'name category' },
      { path: 'memberId', select: 'name regNumber' },
    ]);
    res.json({
      fine: toFineJson(result.fine),
      undone: result.amount,
      returnedToBalance: result.source === 'balance' ? result.amount : 0,
    });
  } catch (err) {
    respondPaymentError(err, res, next);
  }
}

// GET /api/fines/payments/to-check — payments recorded before the office was asked how they were
// made. Nobody can tell from the record whether each was cash or taken from the balance, so they
// are listed for a person to say.
async function paymentsToCheck(req, res, next) {
  try {
    const rows = await listUnreviewedPayments();
    res.json({
      payments: rows,
      total: rows.reduce((sum, r) => sum + r.amount, 0),
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/fines/payments/check — says how earlier payments were made.
// Body: { items: [{ fineId, index, amount, source: 'balance' | 'cash' }] }
async function checkPayments(req, res, next) {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return res.status(400).json({ message: 'Choose at least one payment' });
    if (items.length > 200) return res.status(400).json({ message: 'Sort out at most 200 payments at a time' });

    // One by one, in the order the office gave them: each is checked against the balance as the one
    // before it left it, and one that cannot be done (he does not hold enough) is reported without
    // stopping the rest.
    const done = [];
    const failed = [];
    for (const item of items) {
      const source = readSource(item?.source);
      const label = { fineId: item?.fineId, index: item?.index };
      if (!source || !mongoose.Types.ObjectId.isValid(item?.fineId)) {
        failed.push({ ...label, message: 'Choose how this was paid' });
        continue;
      }
      try {
        const result = await reviewFinePayment({
          fineId: item.fineId,
          index: Number.parseInt(item.index, 10),
          source,
          expected: item.amount === undefined ? undefined : Number(item.amount),
        });
        await logAudit({
          action: 'update',
          entityType: 'Fine',
          entityId: result.fine._id,
          performedBy: req.user._id,
          before: result.before,
          after: {
            ...snapshot(result.fine),
            paymentChecked: { index: Number(item.index), amount: result.amount, source, heldBefore: result.heldBefore },
          },
        });
        done.push({ ...label, source });
      } catch (err) {
        if (!(err instanceof FinePaymentError)) throw err;
        failed.push({ ...label, message: err.message });
      }
    }
    res.json({ done: done.length, failed });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/fines/:id — void a wrongly-issued fine (soft delete)
async function voidFine(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: 'Fine not found' });
    }
    const outcome = await withOptionalTransaction(async (session) => {
      const fine = await Fine.findById(req.params.id).session(session || null);
      if (!fine || fine.deleted) return null;
      const before = snapshot(fine);

      fine.deleted = true;
      await fine.save({ session });
      // A fine that should never have been issued cannot have been paid out of his balance: the
      // money goes back to him in the same breath. Cash he handed over is left as the record of
      // what was received, and reported so the office can say what it did with it.
      const released = await releaseFineDebits(fine, { session });
      return { fine, before, released };
    });
    if (!outcome) return res.status(404).json({ message: 'Fine not found' });

    await logAudit({
      action: 'delete',
      entityType: 'Fine',
      entityId: outcome.fine._id,
      performedBy: req.user._id,
      before: outcome.before,
      after: {
        ...snapshot(outcome.fine),
        returnedToBalance: outcome.released.returned,
        returnedToPayments: outcome.released.restoredTotal,
        cashReceived: outcome.released.cash,
      },
    });
    // The payments the fine had been paid out of are changed too, so each one has its own entry.
    for (const { payment, before, amount } of outcome.released.restored) {
      await logAudit({
        action: 'update',
        entityType: 'Contribution',
        entityId: payment._id,
        performedBy: req.user._id,
        before,
        after: { ...snapshot(payment), fineVoided: { fineId: outcome.fine._id, restored: amount } },
      });
    }
    res.json({
      ok: true,
      returnedToBalance: outcome.released.returned,
      // Money that had gone to this fine out of a logged payment, now back on that payment.
      returnedToPayments: outcome.released.restoredTotal,
      cashReceived: outcome.released.cash,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/fines/summary — the group's fines in the four cuts a meeting works
// through: the totals, the fine types carrying the debt, who owes it, and how it
// has moved month by month. Scoped exactly like listFines, so the disciplinary
// officer's report can only ever count his own category of fines.
async function finesSummary(req, res, next) {
  try {
    const scope = await scopeForUser(req.user);
    const fines = await Fine.find({ ...scope.filter, deleted: false })
      .populate('memberId', 'name regNumber phone active')
      .populate('typeId', 'name category')
      .populate('issuedBy', 'name')
      .lean();

    const report = buildFineGroupReport({ fines, scopeLabel: scope.scopeLabel });
    report.preparedBy = req.user?.name || '';

    res.json({
      scopeLabel: report.scopeLabel,
      totals: report.totals,
      byType: report.byType,
      byMember: report.byMember,
      byMonth: report.byMonth,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/fines/export?format=pdf|xlsx — the same group report as a document.
async function exportFines(req, res, next) {
  try {
    const scope = await scopeForUser(req.user);
    const [fines, settings] = await Promise.all([
      Fine.find({ ...scope.filter, deleted: false })
        .populate('memberId', 'name regNumber phone active')
        .populate('typeId', 'name category')
        .populate('issuedBy', 'name')
        .lean(),
      getOrCreateSettings(),
    ]);

    const report = buildFineGroupReport({ fines, scopeLabel: scope.scopeLabel });
    report.preparedBy = req.user?.name || '';

    const format = String(req.query.format || 'pdf').toLowerCase();
    if (format === 'xlsx' || format === 'excel') {
      return sendWorkbook(res, 'fines-group.xlsx', fineGroupReportSheets(report, settings.chamaName));
    }
    return renderFineGroupReportPdf(res, report, settings.chamaName);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listFines,
  finesSummary,
  exportFines,
  exportMemberFines,
  createFine,
  settleFine,
  payMemberFines,
  memberFinePosition,
  undoFinePayment,
  paymentsToCheck,
  checkPayments,
  voidFine,
};
