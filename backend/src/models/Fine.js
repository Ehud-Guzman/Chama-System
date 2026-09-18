const { Schema, model } = require('mongoose');
const { moneySetter, MONEY_MIN, MONEY_MAX } = require('../utils/money');

// A settlement records how a fine was paid down, either automatically (from a
// contribution's fine-deduction step) or manually (contributionId left null).
const SettlementSchema = new Schema(
  {
    contributionId: { type: Schema.Types.ObjectId, ref: 'Contribution', default: null },
    amount: { type: Number, required: true, set: moneySetter, min: MONEY_MIN, max: MONEY_MAX },
    date: { type: Date, default: Date.now },
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
