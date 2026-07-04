const { Schema, model } = require('mongoose');

const ContributionSchema = new Schema(
  {
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    typeId: { type: Schema.Types.ObjectId, ref: 'ContributionType', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now },
    method: { type: String, enum: ['cash', 'bank', 'mobile', 'other'], required: true },
    note: { type: String, default: '' },
    loggedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deleted: { type: Boolean, default: false },
    // Set only when a pending fine ate into this payment. `amount` above always
    // stays the net credited value so existing $sum aggregations are unaffected.
    // `grossAmount` is what the member physically handed over.
    grossAmount: { type: Number, default: null },
    fineDeducted: { type: Number, default: 0 },
    // Idempotency key from the client — lets a retried/duplicated request
    // resolve to the original document instead of creating a second one.
    clientRequestId: { type: String, index: true, unique: true, sparse: true },
  },
  { timestamps: true }
);

module.exports = model('Contribution', ContributionSchema);
