const { Schema, model } = require('mongoose');

// A settlement records how a fine was paid down, either automatically (from a
// contribution's fine-deduction step) or manually (contributionId left null).
const SettlementSchema = new Schema(
  {
    contributionId: { type: Schema.Types.ObjectId, ref: 'Contribution', default: null },
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const FineSchema = new Schema(
  {
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    typeId: { type: Schema.Types.ObjectId, ref: 'FineType', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    // Decremented as settlements are applied. <= 0 means fully settled.
    remaining: { type: Number, required: true, min: 0 },
    reason: { type: String, default: '' },
    date: { type: Date, required: true, default: Date.now },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    settlements: { type: [SettlementSchema], default: [] },
    deleted: { type: Boolean, default: false }, // void a wrongly-issued fine
  },
  { timestamps: true }
);

module.exports = model('Fine', FineSchema);
