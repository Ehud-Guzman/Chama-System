const { Schema, model } = require('mongoose');
const { moneySetter, MONEY_MIN, MONEY_MAX } = require('../utils/money');

// A loan the group has made to one member, out of a loan fund.
//
// The books already know how to hold money that is out on loan: a fund flagged `isRecoverable` has
// its payouts counted as "owed back" instead of "spent". A loan therefore does not invent a second
// ledger. Lending records an ordinary expense from the loan fund (linked back here by `expenseId`);
// each repayment gives principal back by reducing that expense, and records only the interest as
// income. So every figure the group already reads — the fund's balance, what is out on loan, what
// the group holds — stays right without any of them knowing loans exist.
//
// What is derived (what is outstanding, what is overdue, the schedule) is NOT stored: it is worked
// out from these terms and the repayments (utils/loanMath), so it can never disagree with them.
const RepaymentSchema = new Schema(
  {
    amount: { type: Number, required: true, set: moneySetter, min: [0.01, 'A repayment must be more than zero'], max: MONEY_MAX[0] },
    // How the amount divided, fixed at the time (utils/loanMath splitRepayment).
    principalPart: { type: Number, required: true, set: moneySetter, min: MONEY_MIN },
    interestPart: { type: Number, required: true, set: moneySetter, min: MONEY_MIN },
    date: { type: Date, required: true },
    method: { type: String, enum: ['cash', 'bank', 'mobile', 'other'], default: 'cash' },
    note: { type: String, default: '', maxlength: 300 },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // The income row recording the interest part, so taking the repayment back can remove it.
    contributionId: { type: Schema.Types.ObjectId, ref: 'Contribution', default: null },
    // A submit sent twice (a dropped answer, a double tap) finds the first instead of recording again.
    requestId: { type: String, default: '', maxlength: 100 },
  },
  { _id: false }
);

const LoanSchema = new Schema(
  {
    loanNumber: { type: String, required: true, unique: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    // The loan fund the money came out of (a contribution type flagged isRecoverable).
    fundId: { type: Schema.Types.ObjectId, ref: 'ContributionType', required: true },
    principal: { type: Number, required: true, set: moneySetter, min: [0.01, 'The amount lent must be more than zero'], max: MONEY_MAX[0] },
    // Flat, charged once on the principal over the whole term (not per month).
    interestPercent: { type: Number, required: true, min: 0, max: 100 },
    termMonths: { type: Number, required: true, min: 1, max: 60 },
    // The day the money was lent, as an instant (midnight EAT). Instalments fall due monthly from it.
    issuedAt: { type: Date, required: true },
    // The disbursement, recorded as an expense from the loan fund.
    expenseId: { type: Schema.Types.ObjectId, ref: 'Expense', default: null },
    // The minute that approved it, when it was above the group's spending limit.
    approvalRef: { type: String, default: '', trim: true, maxlength: 120 },
    note: { type: String, default: '', maxlength: 500 },
    repayments: { type: [RepaymentSchema], default: [] },
    status: { type: String, enum: ['active', 'cleared', 'cancelled'], default: 'active', index: true },
    clearedAt: { type: Date, default: null },
    cancelledReason: { type: String, default: '', maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

module.exports = model('Loan', LoanSchema);
