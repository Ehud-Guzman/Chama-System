const { Schema, model } = require('mongoose');

// Meeting minutes. Kept out of every public route except the phone-gated ones
// (see publicListMinutes / publicGetMinute) — and even there only when an admin
// has left `visibleToMembers` on, since a minute can name a member and their
// disciplinary issue.
const MinuteSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    date: { type: Date, required: true, default: Date.now },
    content: { type: String, default: '' },
    // On by default (the group wants members reading the minutes), but a
    // sensitive minute — a disciplinary hearing, a dispute settlement — can be
    // withheld from the members' page.
    visibleToMembers: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = model('Minute', MinuteSchema);
