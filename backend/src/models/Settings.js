const { Schema, model } = require('mongoose');

// Singleton document — one row holds group-wide identity info.
// No multi-tenant support, so there is never more than one of these.
const SettingsSchema = new Schema(
  {
    chamaName: { type: String, required: true, trim: true, default: 'Our Chama' },
    constitution: { type: String, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = model('Settings', SettingsSchema);
