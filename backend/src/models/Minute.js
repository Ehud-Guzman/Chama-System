const { Schema, model } = require('mongoose');

// Meeting minutes. Kept out of every public route except the phone-gated ones
// (see publicListMinutes / publicGetMinute) — and even there only when an admin
// has left `visibleToMembers` on, since a minute can name a member and their
// disciplinary issue.
const MinuteSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    date: { type: Date, required: true, default: Date.now },
    // Sanitised against the editor's own schema on write (utils/sanitizeHtml), so
    // what is stored is only ever what the editor can produce — whatever client
    // sent it.
    content: { type: String, default: '', maxlength: 200000 },
    // How many pages this minute is, on A4 at 12pt with one-inch margins — the group's own rule
    // for the figure it bills on (utils/minutePages). Counted when the minute is written, because
    // the count is a real layout of the real text and doing that for a hundred minutes on every
    // list would cost seconds. `null` means "never counted" — a minute saved before this field
    // existed — and scripts/countMinutePages.js fills those in (or recounts the lot after a change
    // to the rule, which is the only thing that can make a stored count stale).
    pages: { type: Number, default: null },
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

// The members' list: published minutes, newest first.
MinuteSchema.index({ deleted: 1, visibleToMembers: 1, date: -1 });

module.exports = model('Minute', MinuteSchema);
