const { Schema, model } = require('mongoose');

const MemberSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // `unique: true` already creates an index — no need for `index: true` too.
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    regNumber: { type: String, unique: true, sparse: true },
    notes: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    active: { type: Boolean, default: true },
    // Anchor for this member's own weekly-contribution schedule (week 1 starts here).
    joinDate: { type: Date, default: Date.now },
    resignedAt: { type: Date, default: null },
    resignationReason: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = model('Member', MemberSchema);
