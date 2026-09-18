const { Schema, model } = require('mongoose');

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['super_admin', 'admin', 'treasurer', 'secretary', 'disciplinary'], default: 'admin' },
    active: { type: Boolean, default: true },
    // When the password last changed. Every token issued before this instant is
    // refused (see middleware/auth), which is what makes "change your password"
    // actually end the other sessions — including a thief's.
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = model('User', UserSchema);
