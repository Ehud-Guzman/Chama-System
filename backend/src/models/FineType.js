const { Schema, model } = require('mongoose');

const FineTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    active: { type: Boolean, default: true }, // soft-delete flag, same pattern as ContributionType
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // 'financial' = treasurer-issued fines (late payment, etc.). 'disciplinary'
    // = conduct infractions issued by the disciplinary officer (lateness,
    // absence, phone use in meetings...) — kept separate so each role only
    // ever sees/issues the types that belong to it.
    category: { type: String, enum: ['financial', 'disciplinary'], default: 'financial' },
    // Pre-set penalty for this type, e.g. Ksh 50 for Lateness — lets the
    // disciplinary officer just pick a type and a date, no amount to type in.
    defaultAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = model('FineType', FineTypeSchema);
