const { Schema, model } = require('mongoose');
const { moneySetter, MONEY_MIN, MONEY_MAX } = require('../utils/money');

// How the money for a payment reached the group, which is what decides whether it comes off
// what the member holds:
//
//   contribution  taken out of a payment he handed over (Settings.autoSettleFines). The
//                 contribution row carries the same amount as `fineDeducted`.
//   balance       taken from the money the group already holds for him. It comes off his
//                 balance on the day it is recorded, and Member.fineDebits keeps the dated
//                 entry the ledger engine subtracts.
//   cash          he handed it over separately (cash, M-Pesa). His balance is untouched
//                 because none of it was ever in his balance.
//
// A settlement with no `source` at all is a manual payment recorded before the office was
// asked which of the last two it was. It moves nothing until somebody says (Fines → Past
// payments to check), because nobody can tell from the record which one it was.
const SETTLEMENT_SOURCES = ['contribution', 'balance', 'cash'];

// A settlement records how a fine was paid down, either automatically (from a
// contribution's fine-deduction step) or manually (contributionId left null).
const SettlementSchema = new Schema(
  {
    contributionId: { type: Schema.Types.ObjectId, ref: 'Contribution', default: null },
    amount: { type: Number, required: true, set: moneySetter, min: MONEY_MIN, max: MONEY_MAX },
    date: { type: Date, default: Date.now },
    source: { type: String, enum: SETTLEMENT_SOURCES },
    // Who keyed a manual payment in. Not set on payments taken out of a contribution: the
    // contribution row already names who logged it.
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // The key the screen attached to this payment. A submit that is sent twice (a dropped
    // connection followed by a retry, two taps) carries the same key, and finds the payment already
    // on the fine instead of recording it again.
    requestId: { type: String, maxlength: 100 },
  },
  { _id: false }
);

const FineSchema = new Schema(
  {
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    typeId: { type: Schema.Types.ObjectId, ref: 'FineType', required: true, index: true },
    amount: { type: Number, required: true, set: moneySetter, min: MONEY_MIN, max: MONEY_MAX },
    // Decremented as settlements are applied. <= 0 means fully settled.
    remaining: { type: Number, required: true, set: moneySetter, min: MONEY_MIN, max: MONEY_MAX },
    reason: { type: String, default: '', maxlength: 500 },
    date: { type: Date, required: true, default: Date.now },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    settlements: { type: [SettlementSchema], default: [] },
    deleted: { type: Boolean, default: false }, // void a wrongly-issued fine
  },
  { timestamps: true }
);

// A member's fines, pending first — the query every member screen and the
// disciplinary export makes.
FineSchema.index({ memberId: 1, deleted: 1, remaining: 1 });
FineSchema.index({ deleted: 1, date: -1 });

module.exports = model('Fine', FineSchema);
module.exports.SETTLEMENT_SOURCES = SETTLEMENT_SOURCES;
