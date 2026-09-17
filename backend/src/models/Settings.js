const { Schema, model } = require('mongoose');

// Singleton document — one row holds group-wide identity info.
// No multi-tenant support, so there is never more than one of these.
const SettingsSchema = new Schema(
  {
    chamaName: { type: String, required: true, trim: true, default: 'Our Chama' },
    constitution: { type: String, default: '' },
    // First week the group-wide weekly reconciliation should evaluate. Weeks
    // before this are pre-tracking history (e.g. a bulk paper-ledger import
    // that only gives a cumulative snapshot, not a per-week breakdown) and
    // would otherwise show as false "everyone defaulted" for every one of
    // them. Null means reconcile from each member's own join date, as before.
    weeklyTrackingStartDate: { type: Date, default: null },
    // --- Week cycle (the group-wide 1,400 / 100 maths) -----------------------
    // Friday that week `cycleStartWeek` begins on. Pinned once by
    // getOrCreateSettings() and never moved: it is the reference every
    // historical week number is counted from.
    weekAnchorDate: { type: Date, default: null },
    // Week number the anchor belongs to — 92 at go-live, +1 every Friday after.
    cycleStartWeek: { type: Number, default: 92 },
    // Required personal contribution per week (constitution §7.1).
    weeklyAmount: { type: Number, default: 1400 },
    // Tea Fund contribution per week. Tracked on its own and never mixed into a
    // member's personal figures — the fund belongs to the Group (§7.2).
    chaiAmount: { type: Number, default: 100 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = model('Settings', SettingsSchema);
