const { Schema, model } = require('mongoose');

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['super_admin', 'admin'], default: 'admin' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = model('User', UserSchema);
