const { Schema, model } = require('mongoose');
const { moneySetter, MONEY_MIN, MONEY_MAX } = require('../utils/money');

// Generic fund expense, keyed by ContributionType rather than hardcoded to any
// one fund — the Chai fund is the first tracksExpenses type, but this works
// for any type flagged that way later.
const ExpenseSchema = new Schema(
  {
    typeId: { type: Schema.Types.ObjectId, ref: 'ContributionType', required: true, index: true },
    amount: { type: Number, required: true, set: moneySetter, min: MONEY_MIN, max: MONEY_MAX },
    date: { type: Date, required: true, default: Date.now },
    description: { type: String, default: '', maxlength: 500 },
    // Same free-text field contributions carry — where the treasurer pastes the
    // M-Pesa/bank message or receipt line a cashless payment came with, so the
    // evidence lives on the entry it belongs to instead of in a side file.
    note: { type: String, default: '', maxlength: 2000 },
    loggedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Fund spending is read as "this fund, over this period" — the date range needs
// to lead the scan, which is what the report aggregations match on.
ExpenseSchema.index({ deleted: 1, date: -1 });
ExpenseSchema.index({ typeId: 1, deleted: 1, date: -1 });

module.exports = model('Expense', ExpenseSchema);
