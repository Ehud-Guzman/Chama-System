// The fines controller, part: office. controllers/fineController.js is the index the routes use.

const Member = require('../../models/Member');
const FineType = require('../../models/FineType');
const Fine = require('../../models/Fine');
const mongoose = require('mongoose');
const { logAudit, snapshot } = require('../../utils/auditLogger');
const { announceFineIssued } = require('../../utils/fineEmails');
const { listUnreviewedPayments, readSource, reviewFinePayment, FinePaymentError, releaseFineDebits } = require('../../utils/fineSettlement');
const { withOptionalTransaction } = require('../../utils/fineAllocation');

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

module.exports = {
  checkPayments,
  createFine,
  paymentsToCheck,
  voidFine,
};
