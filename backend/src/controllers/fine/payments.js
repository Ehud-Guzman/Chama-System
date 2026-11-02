// The fines controller, part: payments. controllers/fineController.js is the index the routes use.

const Member = require('../../models/Member');
const mongoose = require('mongoose');
const Fine = require('../../models/Fine');
const { isAfterToday } = require('../../utils/futureDate');
const { FinePaymentError, readSource, recordFinePayment, recordAllFinesPayment, reverseFinePayment } = require('../../utils/fineSettlement');
const { snapshot, logAudit } = require('../../utils/auditLogger');
const { announceFinesPaid } = require('../../utils/fineEmails');
const { readMoney } = require('../../utils/money');
const { memberLedgerNow } = require('../../utils/memberMoney');
const { toFineJson } = require('./common');

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

  // One payment can clear several fines, each taking its share off his balance in turn. Each
  // fine's entry names the balance as it stood for that fine, so the entries read one after the
  // other instead of every one claiming the whole payment's before and after.
  let running = heldBefore;
  for (const { fine, before, applied: part } of applied) {
    const after = snapshot(fine);
    const fineHeldBefore = running;
    const fineHeldAfter = running === null ? null : Math.round((running - part) * 100) / 100;
    running = fineHeldAfter;
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
          ? {
              ...after,
              paidFromBalance: { amount: part, heldBefore: fineHeldBefore, heldAfter: fineHeldAfter },
            }
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
    // `paid` is what this payment took off each fine, so the screen can show every one as paid.
    fines: result.applied.map(({ fine, applied }) => ({ ...toFineJson(fine), paid: applied })),
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

// POST /api/fines/member/:memberId/pay — pays every fine the member owes at once, oldest first,
// each fine recording its own payment. From his balance it takes no more than he holds.
// Body: { source: 'balance' | 'cash', date?, clientRequestId? }
async function payMemberFines(req, res, next) {
  try {
    const source = readSource(req.body?.source);
    if (!source) return res.status(400).json({ message: SAY_HOW });
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId)) {
      return res.status(404).json({ message: 'Member not found' });
    }
    const when = readPaidAt(req.body?.date);
    if (when.error) return res.status(400).json({ message: when.error });

    const result = await recordAllFinesPayment({
      memberId: req.params.memberId,
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
// owes, oldest first — the order Pay clears them in.
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

module.exports = {
  memberFinePosition,
  payMemberFines,
  settleFine,
  undoFinePayment,
};
