const { Schema, model } = require('mongoose');
const { moneySetter, MONEY_MIN, MONEY_MAX } = require('../utils/money');

const ContributionSchema = new Schema(
  {
    // No standalone index here — every real query filters memberId together
    // with deleted (and usually sorts by date), so the compound index below
    // covers it as a prefix; a separate single-field index would just be
    // redundant write overhead.
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    typeId: { type: Schema.Types.ObjectId, ref: 'ContributionType', required: true, index: true },
    amount: { type: Number, required: true, set: moneySetter, min: MONEY_MIN, max: MONEY_MAX },
    date: { type: Date, required: true, default: Date.now },
    method: { type: String, enum: ['cash', 'bank', 'mobile', 'other'], required: true },
    note: { type: String, default: '', maxlength: 2000 },
    loggedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deleted: { type: Boolean, default: false },
    // Set only when a pending fine ate into this payment. `amount` above always
    // stays the net credited value so existing $sum aggregations are unaffected.
    // `grossAmount` is what the member physically handed over.
    grossAmount: { type: Number, default: null, set: moneySetter, max: MONEY_MAX },
    fineDeducted: { type: Number, default: 0, set: moneySetter, min: MONEY_MIN, max: MONEY_MAX },
    // Idempotency key from the client — lets a retried/duplicated request
    // resolve to the original document instead of creating a second one.
    clientRequestId: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

// Covers the passbook/ledger hot path — Contribution.find({ memberId,
// deleted: false }).sort({ date: -1 }) — used by every member detail view,
// public profile, and statement export.
ContributionSchema.index({ memberId: 1, deleted: 1, date: -1 });

// The report aggregations match on a date range across *every* member, which the
// member-first index above cannot serve — its leading key is memberId. This one can.
ContributionSchema.index({ deleted: 1, date: -1 });

module.exports = model('Contribution', ContributionSchema);
