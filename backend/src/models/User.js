const { Schema, model } = require('mongoose');

// Two-factor authentication, as it lives on the account.
//
// The secret is `select: false` like the password is, and for the same reason: nothing
// that reads a user — the admin list, the audit snapshot, a lean() lookup in a
// controller that has nothing to do with 2FA — should be able to hand out the thing
// that generates the codes. Only the 2FA endpoints ask for it explicitly.
const TwoFactorSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    // Present only between "begin enrolment" and the first code that proves the app was
    // set up correctly. Keeping it separate from `secret` means an abandoned enrolment
    // cannot lock anybody out: until the code verifies, the account still signs in
    // without 2FA.
    pendingSecret: { type: String, default: '', select: false },
    secret: { type: String, default: '', select: false },
    // Single-use recovery codes, stored as HMACs keyed on JWT_SECRET (utils/totp) and
    // removed as they are spent. An empty array with `enabled: true` means the codes
    // have been used up and should be regenerated.
    recoveryCodeHashes: { type: [String], default: [], select: false },
    enrolledAt: { type: Date, default: null },
    // The last thirty-second slot accepted for this account. A code is valid for its
    // whole slot, so without this a code read over a shoulder is still good for the
    // next twenty seconds; recording the slot makes each one usable exactly once.
    lastUsedStep: { type: Number, default: null },
    // How many wrong codes since the last success. Not a lockout, just a number the
    // audit trail is more useful for having.
    lastFailedAt: { type: Date, default: null },
  },
  { _id: false }
);

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
    twoFactor: { type: TwoFactorSchema, default: () => ({}) },
  },
  { timestamps: true }
);

module.exports = model('User', UserSchema);
