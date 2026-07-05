const { Schema, model } = require('mongoose');

// Admin-only meeting minutes — never exposed on any public route.
const MinuteSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    date: { type: Date, required: true, default: Date.now },
    content: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = model('Minute', MinuteSchema);
