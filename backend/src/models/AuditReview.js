const { Schema, model } = require('mongoose');

// A super admin's note on an audit entry: "flagged for review", later "cleared".
//
// A collection of its own rather than a field on the entry, deliberately. The audit trail is
// hash-chained and append-only (utils/auditChain), and a review is a judgement made *about* an
// entry after the fact — it must be able to change without touching the thing it judges, and
// without anybody wondering whether the chain was edited.
const AuditReviewSchema = new Schema(
  {
    entry: { type: Schema.Types.ObjectId, ref: 'AuditLog', required: true, index: true },
    status: { type: String, enum: ['flagged', 'cleared'], required: true },
    note: { type: String, default: '', maxlength: 500 },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// Newest review of an entry wins; the older ones stay as its history.
AuditReviewSchema.index({ entry: 1, createdAt: -1 });

module.exports = model('AuditReview', AuditReviewSchema);
