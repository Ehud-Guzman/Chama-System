// The sign-in controller, part: common. controllers/authController.js is the index the routes use.

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../../models/User');
const jwt = require('jsonwebtoken');
const { getOrCreateSettings } = require('../../utils/settings');

// A hash of a string nobody knows, so a sign-in for an address that has no account
// costs the same time as one for an address that does. Without it the "no such
// user" path returns in a millisecond and the "wrong password" path takes eighty,
// which is a free oracle for which addresses hold accounts.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);

function toDTO(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    // Whether the second factor is on, never the material behind it. The admin list and
    // the settings screen both need to show this, and neither may see the secret.
    twoFactorEnabled: Boolean(user.twoFactor?.enabled),
    twoFactorEnrolledAt: user.twoFactor?.enrolledAt || null,
    // Switched off by the super admin, with a reason, without being deactivated.
    frozen: Boolean(user.frozenAt),
  };
}

// Books a sign-in against the account: when, from where, and that the wrong-password count starts
// again. Best effort — a failed write here must not turn a correct password into an error.
async function recordSignIn(user, req) {
  try {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          lastLoginAt: new Date(),
          lastLoginIp: String(req?.ip || ''),
          lastActiveAt: new Date(),
          failedLoginCount: 0,
        },
      }
    );
  } catch {
    // Bookkeeping only.
  }
}

// One more wrong password (or wrong code) against an account that exists. The super admin's
// Control Room lists the accounts where this is climbing.
async function recordFailedSignIn(user) {
  if (!user?._id) return;
  try {
    await User.updateOne(
      { _id: user._id },
      { $inc: { failedLoginCount: 1 }, $set: { lastFailedLoginAt: new Date() } }
    );
  } catch {
    // Bookkeeping only.
  }
}

// At least 8 characters with a mix of letters and numbers — stops trivial
// all-digit or all-letter passwords without demanding a full complexity policy.
function weakPasswordMessage(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must include both letters and numbers';
  }
  return null;
}

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role, scope: 'session' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

// The ticket between "the password was right" and "the code was right".
//
// Deliberately a JWT of the same shape as a session — one signing path, no session table
// to keep — but five minutes long and stamped `scope: '2fa'`, which middleware/auth
// refuses to accept as a session. Without that stamp the challenge would itself be a
// working token, and the second factor would be decorative.
function signChallenge(user) {
  return jwt.sign({ id: user._id, scope: '2fa' }, process.env.JWT_SECRET, { expiresIn: '5m' });
}

// The one place a challenge is turned back into an account, so the scope check cannot
// be forgotten in one of the endpoints.
function readChallenge(token) {
  const payload = jwt.verify(String(token || ''), process.env.JWT_SECRET, { algorithms: ['HS256'] });
  if (payload.scope !== '2fa') throw new Error('Not a 2FA challenge');
  return payload;
}

// Whether the group is using two-factor authentication at all.
//
// The master switch lives on Settings (super admin only, off by default), and it is read here
// rather than trusted to the user document: an account that enrolled while the feature was on must
// NOT be challenged once the group has switched it off. "Off" has to mean off, or the switch is
// decoration - and a member of the committee being locked out by a feature the committee turned off
// is exactly the kind of thing that destroys trust in the system.
//
// A settings read is cached in-process (utils/settings), so this is not a database round trip on
// every sign-in.
async function twoFactorInUse() {
  try {
    const settings = await getOrCreateSettings();
    return Boolean(settings?.twoFactorAuthEnabled);
  } catch {
    // Settings unreadable this instant (a cold connection): fall back to OFF, which is the safe
    // direction - nobody is challenged, and nobody is locked out.
    return false;
  }
}

module.exports = {
  DUMMY_PASSWORD_HASH,
  readChallenge,
  recordFailedSignIn,
  recordSignIn,
  signChallenge,
  signToken,
  toDTO,
  twoFactorInUse,
  weakPasswordMessage,
};
