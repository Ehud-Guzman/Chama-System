const { Schema, model } = require('mongoose');

// A member's decision on one chapter of the constitution: approved or rejected.
//
// The pair (member, chapter) is unique and nothing here is ever updated, which is
// what makes a decision final — a member cannot quietly change his mind, and the
// office cannot edit the record afterwards. The office sees the same rows on the
// member's profile that the member sees on his own reading page.
const ConstitutionDecisionSchema = new Schema(
  {
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    // Kept alongside the id so the office screen reads without a populate, and so
    // the record still names who decided if the member row is ever renamed.
    memberName: { type: String, default: '', trim: true },
    chapterNumber: { type: Number, required: true },
    chapterTitle: { type: String, default: '', trim: true },
    decision: { type: String, enum: ['approved', 'rejected'], required: true },
    // Why a chapter was rejected — the one thing the assembly cannot reconstruct
    // later, and the whole point of asking. Optional, so approving stays one tap.
    reason: { type: String, default: '', trim: true, maxlength: 500 },
    // The edition the member was reading (constitutionMeta.eyebrow). A later
    // revision can then be told apart from the text that was actually decided on.
    edition: { type: String, default: '', trim: true },
    decidedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One decision per member per chapter. Enforced by the database, not just by the
// controller, so a double tap or a race can never rewrite a decision.
ConstitutionDecisionSchema.index({ memberId: 1, chapterNumber: 1 }, { unique: true });

module.exports = model('ConstitutionDecision', ConstitutionDecisionSchema);
