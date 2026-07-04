const { Schema, model } = require('mongoose');

// Generic fund expense, keyed by ContributionType rather than hardcoded to any
// one fund — the Chai fund is the first tracksExpenses type, but this works
// for any type flagged that way later.
const ExpenseSchema = new Schema(
  {
    typeId: { type: Schema.Types.ObjectId, ref: 'ContributionType', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now },
    description: { type: String, default: '' },
    loggedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = model('Expense', ExpenseSchema);
