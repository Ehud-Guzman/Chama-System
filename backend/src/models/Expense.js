const { Schema, model } = require('mongoose');
const { moneySetter, MONEY_MIN, MONEY_MAX } = require('../utils/money');

// Where the money came from. `fund` is the usual case: a pot the group collects into and
// spends from (tea, registration, a project fund), and the expense names it.
//
// `group` is for what the group buys as a whole out of its total money — land, a
// building, a group asset — where there is no one fund to charge and no member's own
// balance to touch. It is the pooled money the group holds, and it is deliberately not
// made to look like a fund that has gone overdrawn.
const EXPENSE_SOURCES = ['fund', 'group'];

// Generic fund expense, keyed by ContributionType rather than hardcoded to any
// one fund — the Chai fund is the first tracksExpenses type, but this works
// for any type flagged that way later.
const ExpenseSchema = new Schema(
  {
    // Set when the money came from the group's total money rather than a fund; the
    // default keeps every existing row reading as what it is.
    source: { type: String, enum: EXPENSE_SOURCES, default: 'fund' },
    typeId: {
      type: Schema.Types.ObjectId,
      ref: 'ContributionType',
      index: true,
      // A fund is named when one is paying, and only then. A function rather than
      // `true`, because the rule depends on another field of the same document.
      required() {
        return this.source !== 'group';
      },
    },
    amount: { type: Number, required: true, set: moneySetter, min: MONEY_MIN, max: MONEY_MAX },
    date: { type: Date, required: true, default: Date.now },
    description: { type: String, default: '', maxlength: 500 },
    // The number on the paperwork this money left against — a petty-cash voucher, a
    // receipt, an LPO, a supplier's invoice. Free text on purpose: the group's own
    // numbering is not this system's to define, and a treasurer who writes
    // "VOUCHER 014" is doing exactly the right thing. It is what makes an expense
    // arguable in a meeting rather than merely recorded.
    reference: { type: String, default: '', maxlength: 120 },
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
// What was spent out of the group's total money rather than a fund: the group's own
// purchases are listed and totalled together, so they get their own way in.
ExpenseSchema.index({ source: 1, deleted: 1, date: -1 });

module.exports = model('Expense', ExpenseSchema);
