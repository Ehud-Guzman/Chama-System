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
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = model('Settings', SettingsSchema);
