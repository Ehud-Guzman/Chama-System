const mongoose = require('mongoose');
const Fine = require('../models/Fine');

// Paying a fine out of a contribution, and the transaction that has to hold it.
//
// This lived inside contributionController, which is why it only ran on
// POST /api/contributions — an endpoint no screen calls any more. The member
// panel logs money through POST /api/ledger/members/:id/log instead, so a payment
// stopped paying down a pending fine and a fine could only ever be voided, never
// settled. Both controllers use these helpers now, so the two write paths cannot
// disagree about what a payment does.

// Runs `work(session)` inside a transaction when Mongo supports one (any replica
// set, including every Atlas tier). Standalone Mongo — common in local dev —
// rejects transactions outright; there we run the same steps without a session
// rather than failing every write in development.
async function withOptionalTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    if (err.code === 20 || /Transaction numbers/.test(err.message || '')) {
      return work(undefined);
    }
    throw err;
  } finally {
    session.endSession();
  }
}

// Applies a gross payment against a member's pending fines, oldest first, until
// either the fines are exhausted or the amount runs out. Returns the net amount to
// credit as the contribution plus how much was deducted; the caller records the
// resulting settlements against `contribution._id` once that document exists.
//
// The read-modify-write on `fine.remaining` is why this must run inside a
// transaction: two payments landing together would otherwise each see the same
// remaining balance and spend it twice.
async function allocateFinePayment(memberId, grossAmount, session) {
  const pendingFines = await Fine.find({ memberId, deleted: false, remaining: { $gt: 0 } })
    .sort({ date: 1 })
    .session(session);

  let remainingPayment = grossAmount;
  const allocations = [];
  for (const fine of pendingFines) {
    if (remainingPayment <= 0) break;
    const applied = Math.min(remainingPayment, fine.remaining);
    allocations.push({ fine, applied });
    remainingPayment -= applied;
  }

  const fineDeducted = grossAmount - remainingPayment;
  return { netAmount: remainingPayment, fineDeducted, allocations };
}

async function recordFineSettlements(allocations, contributionId, session) {
  for (const { fine, applied } of allocations) {
    fine.remaining = Math.round((fine.remaining - applied) * 100) / 100;
    fine.settlements.push({ contributionId, amount: applied, date: new Date() });
    await fine.save({ session });
  }
}

// Puts a deleted contribution's fine money back on the fines it came from.
async function reverseFineSettlements(contributionId, session) {
  const fines = await Fine.find({ 'settlements.contributionId': contributionId, deleted: false }).session(
    session
  );
  for (const fine of fines) {
    const mine = fine.settlements.filter((s) => String(s.contributionId) === String(contributionId));
    const restored = mine.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    if (restored <= 0) continue;
    fine.settlements = fine.settlements.filter(
      (s) => String(s.contributionId) !== String(contributionId)
    );
    fine.remaining = Math.round((fine.remaining + restored) * 100) / 100;
    await fine.save({ session });
  }
}

module.exports = {
  withOptionalTransaction,
  allocateFinePayment,
  recordFineSettlements,
  reverseFineSettlements,
};
