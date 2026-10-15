const Fine = require('../models/Fine');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const { withOptionalTransaction } = require('./fineAllocation');
const { memberLedgerNow } = require('./memberMoney');
const { toMoney } = require('./money');
const { toEatDateString } = require('./weekCycle');

// Paying fines by hand: the office has the member in front of it and records what he paid.
//
// There are exactly two ways it can have happened, and the difference is the whole point of this
// module, because they move different money:
//
//   balance  the fine is taken out of the money the group already holds for him. It comes off
//            what he holds, today, and the group's cash does not move — the money was already
//            in the group's hands. Never more than he holds.
//   cash     he handed it over separately (cash, M-Pesa). His balance is not touched, because
//            that money was never in it. It is new money in the group's hands.
//
// The third way, a payment redirected to a fine as it is logged (Settings.autoSettleFines), is
// utils/fineAllocation's.
//
// All of it runs in one transaction where the database supports one: the fine's own record and
// the dated entry on the member that takes the money off him are two documents, and one without
// the other would be a fine marked paid by money that never left him (or the other way round).

const MANUAL_SOURCES = ['balance', 'cash'];

// An error that carries the answer the office should be given. The controller turns it into a
// response; everything else is a real failure and goes to the error handler.
class FinePaymentError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'FinePaymentError';
    this.status = status;
  }
}

const ksh = (n) => `Ksh ${Number(n || 0).toLocaleString('en-KE')}`;

const SOURCE_PROMPT =
  'Say how this was paid: taken out of his balance, or paid in cash / M-Pesa. ' +
  'If this screen was already open, refresh the page and try again.';

// Whether a fine was issued on a later day than `paidAt`.
function issuedAfter(fine, paidAt) {
  // The group's own calendar (EAT): the day strings compare in date order.
  return toEatDateString(paidAt) < toEatDateString(fine.date);
}

// Reads the source out of a request body. `null` when it is missing or not one of the two.
function readSource(value) {
  const source = String(value || '').trim().toLowerCase();
  return MANUAL_SOURCES.includes(source) ? source : null;
}

// Records `amount` against one fine. A payment is always against a single named fine: a member pays
// the fine in front of him, and a lump sum quietly spread over several is a payment nobody chose.
// Returns what happened, for the response, the audit entry and the email.
//
// `paidAt` is the day the money changed hands, already validated by the caller.
async function recordFinePayment({ memberId, fineId, amount, source, paidAt, userId, requestId = null }) {
  if (!MANUAL_SOURCES.includes(source)) throw new FinePaymentError(400, SOURCE_PROMPT);
  if (!fineId) throw new FinePaymentError(400, 'Choose which fine is being paid');

  return withOptionalTransaction(async (session) => {
    const member = await Member.findById(memberId).session(session || null).lean();
    if (!member) throw new FinePaymentError(404, 'Member not found');

    const fine = await Fine.findOne({ _id: fineId, memberId, deleted: false }).session(session || null);
    if (!fine) throw new FinePaymentError(404, 'Fine not found');

    // A payment already recorded under this key is the answer, not a second payment. Checked before
    // anything else, because a retry of a payment that cleared the fine would otherwise be told
    // "already settled" for money that was in fact recorded.
    if (requestId) {
      const prior = fine.settlements.find((s) => s.requestId && s.requestId === requestId);
      if (prior) {
        let heldNow = null;
        if (prior.source === 'balance') {
          const ledger = await memberLedgerNow(memberId, { session });
          heldNow = toMoney(ledger ? ledger.money : 0);
        }
        return {
          member,
          applied: [{ fine, before: null, applied: toMoney(prior.amount) }],
          totalApplied: toMoney(prior.amount),
          source: prior.source,
          heldBefore: heldNow === null ? null : toMoney(heldNow + prior.amount),
          heldAfter: heldNow,
          replay: true,
        };
      }
    }

    if (fine.remaining <= 0) throw new FinePaymentError(400, 'Fine is already settled');

    // The day it was paid cannot come before the day the fine was issued. Compared by day, not by
    // the minute the fine was keyed in: a fine written at 10:00 and paid at the same meeting is
    // paid on the day it was issued, and the date the office picks has no time on it.
    if (issuedAfter(fine, paidAt)) {
      throw new FinePaymentError(400, 'A fine cannot be paid before it was issued');
    }

    const owed = toMoney(fine.remaining);
    if (amount > owed + 0.001) {
      throw new FinePaymentError(400, `That is more than the ${ksh(owed)} still owed on this fine`);
    }

    // Taken from his balance: never more than the group holds for him, read inside the
    // transaction so two payments landing together are each checked against the other.
    let heldBefore = null;
    if (source === 'balance') {
      const ledger = await memberLedgerNow(memberId, { session });
      heldBefore = toMoney(ledger ? ledger.money : 0);
      if (amount > heldBefore + 0.001) {
        throw new FinePaymentError(
          400,
          heldBefore > 0
            ? `He holds only ${ksh(heldBefore)}, so at most that can be taken from his balance. ` +
              'Take that much, and record the rest as paid in cash.'
            : 'He holds nothing the group could take this from. Record it as paid in cash instead.'
        );
      }
    }

    const before = JSON.parse(JSON.stringify(fine.toObject()));
    fine.remaining = toMoney(fine.remaining - amount);
    fine.settlements.push({
      contributionId: null,
      amount,
      date: paidAt,
      source,
      recordedBy: userId,
      ...(requestId ? { requestId } : {}),
    });
    await fine.save({ session });

    if (source === 'balance') {
      await Member.updateOne(
        { _id: memberId },
        { $push: { fineDebits: { fineId: fine._id, amount, date: paidAt } } },
        { session }
      );
    }

    return {
      member,
      applied: [{ fine, before, applied: amount }],
      totalApplied: amount,
      source,
      heldBefore,
      heldAfter: heldBefore === null ? null : toMoney(heldBefore - amount),
    };
  });
}

// Takes back a manual payment that was recorded by mistake: the fine is owed again by that
// amount and, if it had come out of his balance, the money goes back to him. Payments taken out
// of a contribution are not undone here (delete the contribution, which gives the fine back),
// and neither is anything that has not been reviewed yet — there is nothing to give back.
//
// `index` is the payment's place in the fine's own list, and `expected` the amount the office was
// looking at when it pressed the button, so a stale screen cannot undo a different payment from
// the one it was showing.
async function reverseFinePayment({ fineId, index, expected }) {
  return withOptionalTransaction(async (session) => {
    const fine = await Fine.findById(fineId).session(session || null);
    if (!fine || fine.deleted) throw new FinePaymentError(404, 'Fine not found');

    const settlement = fine.settlements[index];
    if (!settlement) throw new FinePaymentError(404, 'That payment is no longer on the fine');
    if (expected !== undefined && toMoney(settlement.amount) !== toMoney(expected)) {
      throw new FinePaymentError(409, 'That fine has changed since you opened it. Refresh and try again.');
    }
    if (settlement.contributionId) {
      throw new FinePaymentError(
        400,
        'That payment came out of a contribution. Delete the contribution to give the fine back.'
      );
    }

    const before = JSON.parse(JSON.stringify(fine.toObject()));
    const amount = toMoney(settlement.amount);
    const source = settlement.source || null;

    fine.settlements.splice(index, 1);
    fine.remaining = toMoney(fine.remaining + amount);
    await fine.save({ session });

    if (source === 'balance') {
      // Give back exactly the entry this payment made: same fine, same amount, same day, first
      // match only, so two equal payments undone one at a time each return their own.
      const member = await Member.findById(fine.memberId).session(session || null);
      if (member) {
        const at = new Date(settlement.date).getTime();
        const position = member.fineDebits.findIndex(
          (d) =>
            String(d.fineId) === String(fine._id) &&
            toMoney(d.amount) === amount &&
            new Date(d.date).getTime() === at
        );
        if (position >= 0) {
          member.fineDebits.splice(position, 1);
          await member.save({ session });
        }
      }
    }

    return { fine, before, amount, source };
  });
}

// Payments the office recorded before it was asked how they were made. Nobody can tell from the
// record whether the member handed over cash or the fine was meant to come out of his balance, so
// these are listed for a person to say — one at a time or all at once — and until then they move
// nothing on his side. Contribution payments are never in this list: they say how they were paid.
function isUnreviewed(settlement) {
  return !settlement.source && !settlement.contributionId;
}

async function listUnreviewedPayments() {
  const fines = await Fine.find({
    deleted: false,
    settlements: { $elemMatch: { contributionId: null, source: { $exists: false } } },
  })
    .populate('memberId', 'name regNumber')
    .populate('typeId', 'name')
    .sort({ date: 1 })
    .lean();

  const rows = [];
  for (const fine of fines) {
    fine.settlements.forEach((settlement, index) => {
      if (!isUnreviewed(settlement)) return;
      rows.push({
        fineId: fine._id,
        index,
        amount: toMoney(settlement.amount),
        paidOn: settlement.date,
        memberId: fine.memberId?._id || fine.memberId,
        memberName: fine.memberId?.name || 'Member',
        memberRegNumber: fine.memberId?.regNumber || null,
        type: fine.typeId?.name || 'Fine',
        reason: fine.reason || '',
      });
    });
  }
  return rows.sort((a, b) => new Date(a.paidOn) - new Date(b.paidOn));
}

// Says how one earlier payment was made. `cash` only labels it. `balance` also takes the money off
// what he holds, dated the day the payment was recorded for, so his statements show it where it
// happened — and, like a new payment, never takes more than he holds.
async function reviewFinePayment({ fineId, index, source, expected }) {
  if (!MANUAL_SOURCES.includes(source)) throw new FinePaymentError(400, SOURCE_PROMPT);

  return withOptionalTransaction(async (session) => {
    const fine = await Fine.findById(fineId).session(session || null);
    if (!fine || fine.deleted) throw new FinePaymentError(404, 'Fine not found');

    const settlement = fine.settlements[index];
    if (!settlement) throw new FinePaymentError(404, 'That payment is no longer on the fine');
    if (!isUnreviewed(settlement)) {
      throw new FinePaymentError(409, 'That payment has already been sorted out. Refresh the list.');
    }
    const amount = toMoney(settlement.amount);
    if (expected !== undefined && toMoney(expected) !== amount) {
      throw new FinePaymentError(409, 'That payment has changed since you opened the list. Refresh and try again.');
    }

    let heldBefore = null;
    if (source === 'balance') {
      const ledger = await memberLedgerNow(fine.memberId, { session });
      heldBefore = toMoney(ledger ? ledger.money : 0);
      if (amount > heldBefore + 0.001) {
        throw new FinePaymentError(
          400,
          `He holds only ${ksh(heldBefore)}, which is less than the ${ksh(amount)} to take. ` +
            'Mark this one as paid in cash instead.'
        );
      }
    }

    const before = JSON.parse(JSON.stringify(fine.toObject()));
    fine.settlements[index].source = source;
    fine.markModified('settlements');
    await fine.save({ session });

    if (source === 'balance') {
      await Member.updateOne(
        { _id: fine.memberId },
        { $push: { fineDebits: { fineId: fine._id, amount, date: settlement.date } } },
        { session }
      );
    }
    return { fine, before, amount, source, heldBefore };
  });
}

// What voiding a fine has to put right: money taken from his balance for it goes back, because a
// fine that should never have been issued cannot have been paid. Cash he handed over stays as the
// record of what was received — the office decides what to do with it — and is reported so the
// screen can say so.
async function releaseFineDebits(fine, { session } = {}) {
  // Money that went to this fine out of a payment he handed over (Settings.autoSettleFines) was
  // taken off his held figure when it was spent on the fine. The fine never should have existed, so
  // it goes back onto that payment: his held money is whole again and the payment reads as the
  // contribution it was. Without this a voided fine would go on costing him the money it was paid
  // with.
  const restored = [];
  for (const settlement of fine.settlements || []) {
    if (!settlement.contributionId) continue;
    const payment = await Contribution.findById(settlement.contributionId).session(session || null);
    if (!payment || payment.deleted) continue;
    const back = toMoney(Math.min(Number(settlement.amount) || 0, Number(payment.fineDeducted) || 0));
    if (back <= 0) continue;

    const before = JSON.parse(JSON.stringify(payment.toObject()));
    payment.fineDeducted = toMoney(payment.fineDeducted - back);
    payment.amount = toMoney(payment.amount + back);
    // With nothing left going to a fine the row is a plain payment again: what he handed over is
    // simply its amount.
    if (payment.fineDeducted <= 0) payment.grossAmount = null;
    await payment.save({ session });
    restored.push({ payment, before, amount: back });
  }
  const restoredTotal = toMoney(restored.reduce((sum, r) => sum + r.amount, 0));

  const member = await Member.findById(fine.memberId).session(session || null);
  if (!member) return { returned: 0, cash: 0, restored, restoredTotal };

  const mine = member.fineDebits.filter((d) => String(d.fineId) === String(fine._id));
  const returned = toMoney(mine.reduce((sum, d) => sum + (Number(d.amount) || 0), 0));
  if (mine.length > 0) {
    member.fineDebits = member.fineDebits.filter((d) => String(d.fineId) !== String(fine._id));
    await member.save({ session });
  }

  const cash = toMoney(
    (fine.settlements || [])
      .filter((s) => s.source === 'cash')
      .reduce((sum, s) => sum + (Number(s.amount) || 0), 0)
  );
  return { returned, cash, restored, restoredTotal };
}

module.exports = {
  MANUAL_SOURCES,
  FinePaymentError,
  readSource,
  recordFinePayment,
  reverseFinePayment,
  releaseFineDebits,
  isUnreviewed,
  listUnreviewedPayments,
  reviewFinePayment,
};
