const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { getOrCreateSettings } = require('../utils/settings');
const { logAudit } = require('../utils/auditLogger');
const { logEvent, logLoginFailure } = require('../middleware/requestLogger');
const {
  generateSecret,
  otpauthUrl,
  verifyTotp,
  generateRecoveryCodes,
  matchRecoveryCode,
} = require('../utils/totp');

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
  };
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

// POST /api/auth/login (public, rate-limited)
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const address = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: address }).select('+password');

    // Compared against *something* either way, so the response time does not say
    // whether the address exists.
    const matches = await bcrypt.compare(String(password), user?.password || DUMMY_PASSWORD_HASH);

    if (!user || !matches) {
      logLoginFailure({
        email: address,
        ip: req.ip,
        rid: req.id,
        reason: user ? 'wrong_password' : 'no_such_account',
      });
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (!user.active) {
      logLoginFailure({ email: address, ip: req.ip, rid: req.id, reason: 'deactivated' });
      return res.status(401).json({ message: 'This account has been deactivated' });
    }

    // The password was right, but it is not the whole sign-in any more - for groups that have
    // switched the second factor on. What goes back is a five-minute challenge, not a session:
    // everything the client may do with it is POST the code to /api/auth/2fa/verify.
    if (user.twoFactor?.enabled && (await twoFactorInUse())) {
      logEvent('login_password_ok_2fa_pending', { rid: req.id, userId: String(user._id) });
      return res.json({
        twoFactorRequired: true,
        challenge: signChallenge(user),
        // The sign-in screen needs to say *why* it is asking, and naming the account's
        // own email lets somebody notice they are signing into the wrong one.
        email: user.email,
      });
    }

    logEvent('login_ok', { rid: req.id, userId: String(user._id), role: user.role });
    res.json({ token: signToken(user), user: toDTO(user) });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/2fa/verify (public, rate-limited) — step two of the sign-in.
//
// Accepts either a six-digit code from the authenticator app or one of the recovery
// codes, because the case this has to survive is a phone that is lost, broken or in a
// river — with the books still needing to be opened.
async function verifyTwoFactor(req, res, next) {
  try {
    const { challenge, code } = req.body || {};
    if (!challenge || !code) {
      return res.status(400).json({ message: 'A challenge and a code are required' });
    }

    let userId;
    try {
      userId = readChallenge(challenge).id;
    } catch {
      // Expired, tampered with, or a session token pasted in: all the same answer, and
      // the same answer as a wrong code — nothing here should help somebody work out
      // which part of the pair was wrong.
      return res.status(401).json({ message: 'That sign-in has expired. Please enter your password again.' });
    }

    const user = await User.findById(userId).select(
      '+twoFactor.secret +twoFactor.recoveryCodeHashes'
    );
    if (!user || !user.active || !user.twoFactor?.enabled) {
      return res.status(401).json({ message: 'That sign-in has expired. Please enter your password again.' });
    }

    // The group may have switched the second factor off while this challenge was in hand. It has a
    // five-minute life, so this is not hypothetical: somebody starts signing in, the switch is
    // flipped, and the honest answer is "sign in with your password" rather than an error.
    if (!(await twoFactorInUse())) {
      return res.status(401).json({
        message: 'Two-factor authentication has been switched off. Please sign in with your password.',
      });
    }

    // A recovery code first: they are the longer string and cannot be mistaken for a
    // six-digit code, so a wrong six-digit code never spends one.
    const remaining = matchRecoveryCode(code, user.twoFactor.recoveryCodeHashes || []);
    if (remaining) {
      user.twoFactor.recoveryCodeHashes = remaining;
      // Recovery codes are the weak link in any 2FA setup — they are written down, and
      // they do not expire. So using one is a loud event: it is logged, and the admin is
      // shown how many he has left on the next load.
      await user.save();
      await logAudit({
        action: 'update',
        entityType: 'User',
        entityId: user._id,
        performedBy: user._id,
        after: {
          changed: 'signed in with a recovery code',
          recoveryCodesRemaining: remaining.length,
        },
      });
      logEvent('login_ok_recovery_code', { rid: req.id, userId: String(user._id), remaining: remaining.length });
      return res.json({
        token: signToken(user),
        user: toDTO(user),
        usedRecoveryCode: true,
        recoveryCodesRemaining: remaining.length,
      });
    }

    const result = verifyTotp(user.twoFactor.secret, code, {
      lastUsedStep: user.twoFactor.lastUsedStep,
    });
    if (!result.ok) {
      user.twoFactor.lastFailedAt = new Date();
      await user.save();
      logLoginFailure({ email: user.email, ip: req.ip, rid: req.id, reason: 'wrong_2fa_code' });
      return res.status(401).json({
        message:
          result.reason === 'format'
            ? 'That code is not six digits. Check the app and try again.'
            : 'That code is not right. Codes change every 30 seconds — try the current one.',
      });
    }

    // Recording the accepted slot is what makes a code single-use. Without it, the same
    // six digits keep working for the rest of their thirty seconds.
    user.twoFactor.lastUsedStep = result.step;
    await user.save();

    logEvent('login_ok_2fa', { rid: req.id, userId: String(user._id), role: user.role });
    res.json({ token: signToken(user), user: toDTO(user) });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/me (admin+)
//
// Also says whether the group has two-factor authentication switched on. The Security panel needs
// it to know whether to offer enrolment or explain that the feature is off, and this endpoint is
// the one place every signed-in role can reach without a new permission.
async function me(req, res) {
  res.json({
    user: toDTO(req.user),
    twoFactorAuthEnabled: await twoFactorInUse(),
  });
}

// PATCH /api/auth/me/password (admin+) — self-service password change
async function changeOwnPassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    const weakMessage = weakPasswordMessage(newPassword);
    if (weakMessage) {
      return res.status(400).json({ message: weakMessage });
    }
    const user = await User.findById(req.user._id).select('+password');
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    user.password = await bcrypt.hash(String(newPassword), 10);
    // Ends every other session for this account: any token issued before now is
    // refused by requireAuth (see middleware/auth).
    user.passwordChangedAt = new Date();
    await user.save();
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: user._id,
      performedBy: req.user._id,
      after: { changed: 'password' },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/admins (super_admin, admin)
async function listAdmins(req, res, next) {
  try {
    const admins = await User.find().sort({ createdAt: 1 });
    res.json({ admins: admins.map(toDTO) });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/admins (super_admin, admin) — super_admin may create an
// 'admin', 'secretary' or 'disciplinary'; a plain admin may only create a
// 'secretary' or 'disciplinary' account.
async function createAdmin(req, res, next) {
  try {
    const { name, email, password } = req.body || {};
    const role = ['secretary', 'disciplinary'].includes(req.body?.role) ? req.body.role : 'admin';
    if (!name || !String(name).trim() || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (role === 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Only the super admin can create an admin account' });
    }
    const weakMessage = weakPasswordMessage(password);
    if (weakMessage) {
      return res.status(400).json({ message: weakMessage });
    }
    const hashed = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      password: hashed,
      role,
    });
    await logAudit({
      action: 'create',
      entityType: 'User',
      entityId: user._id,
      performedBy: req.user._id,
      after: toDTO(user),
    });
    res.status(201).json({ user: toDTO(user) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/auth/admins/:id (super_admin, admin) — deactivate/reactivate
// only. A plain admin may only act on 'secretary'/'disciplinary' accounts.
async function updateAdmin(req, res, next) {
  try {
    const { active } = req.body || {};
    if (typeof active !== 'boolean') {
      return res.status(400).json({ message: 'active (true/false) is required' });
    }
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot deactivate your own account' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Admin not found' });
    if (target.role === 'super_admin') {
      return res.status(400).json({ message: 'The super admin account cannot be deactivated' });
    }
    if (req.user.role === 'admin' && !['secretary', 'disciplinary'].includes(target.role)) {
      return res.status(403).json({ message: 'You can only manage secretary and disciplinary accounts' });
    }
    const before = toDTO(target);
    target.active = active;
    await target.save();
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: target._id,
      performedBy: req.user._id,
      before,
      after: toDTO(target),
    });
    res.json({ user: toDTO(target) });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/admins/:id/reset-password (super_admin, admin) — there is
// no self-serve "forgot password" flow (no email delivery in this system,
// by design). A plain admin may only reset a 'secretary' account's password.
async function resetAdminPassword(req, res, next) {
  try {
    const { password } = req.body || {};
    const weakMessage = weakPasswordMessage(password);
    if (!password || weakMessage) {
      return res.status(400).json({ message: weakMessage || 'New password must be at least 8 characters' });
    }
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ message: 'Use "Change my password" for your own account' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Admin not found' });
    if (req.user.role === 'admin' && !['secretary', 'disciplinary'].includes(target.role)) {
      return res.status(403).json({ message: 'You can only manage secretary and disciplinary accounts' });
    }

    target.password = await bcrypt.hash(String(password), 10);
    // The reset ends the account's existing sessions too — that is usually the
    // whole point of resetting a password somebody else may know.
    target.passwordChangedAt = new Date();
    await target.save();
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: target._id,
      performedBy: req.user._id,
      after: { changed: 'password (reset by super admin)', for: target.email },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/me/2fa/setup (admin+) — begin enrolment.
//
// Nothing is switched on here. A secret is generated and held as *pending*, and the
// account keeps signing in with a password alone until a code from the app verifies — so
// an admin who scans the QR code, gets distracted and never comes back is not locked out
// of his own account by a half-finished setup.
async function beginTwoFactorSetup(req, res, next) {
  try {
    // Off for the group means off: nobody sets it up until somebody with the authority has decided
    // the group is using it. Otherwise an admin enrols, and nothing he did takes effect - the worst
    // of both worlds.
    if (!(await twoFactorInUse())) {
      return res.status(403).json({
        message:
          'Two-factor authentication is switched off for this group. The super admin can turn it on in Settings → Security.',
      });
    }
    if (req.user.twoFactor?.enabled) {
      return res.status(400).json({ message: 'Two-factor authentication is already on for this account' });
    }

    const secret = generateSecret();
    const settings = await Settings.findOne({ key: 'main' });
    const issuer = settings?.chamaName || 'Chama';

    // Stored on the user rather than in a signed token the client carries back: the
    // secret must never make a round trip it could be swapped on, and this way starting a
    // second enrolment simply replaces the first.
    await User.updateOne({ _id: req.user._id }, { $set: { 'twoFactor.pendingSecret': secret } });

    res.json({
      secret,
      // What the enrolment screen draws as a QR code (and prints underneath, for a phone
      // that cannot scan its own screen).
      otpauthUrl: otpauthUrl({ secret, label: `${issuer}:${req.user.email}`, issuer }),
      issuer,
      account: req.user.email,
      digits: 6,
      period: 30,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/me/2fa/enable (admin+) — the code that proves the app works.
//
// This is the only moment the recovery codes are ever shown. They are generated here,
// stored as hashes, and returned once: the server cannot read them back afterwards, so
// "I lost the paper" is answered by regenerating, not by looking them up.
async function enableTwoFactor(req, res, next) {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ message: 'Enter the six-digit code from your authenticator app' });
    if (!(await twoFactorInUse())) {
      return res.status(403).json({
        message: 'Two-factor authentication is switched off for this group.',
      });
    }

    const user = await User.findById(req.user._id).select('+twoFactor.pendingSecret');
    const pending = user?.twoFactor?.pendingSecret;
    if (!pending) {
      return res.status(400).json({ message: 'Start the setup again — this enrolment has expired' });
    }

    const result = verifyTotp(pending, code);
    if (!result.ok) {
      return res.status(400).json({
        message:
          result.reason === 'format'
            ? 'That code is not six digits'
            : 'That code is not right. Check the app has the right time and try the current code.',
      });
    }

    const { codes, hashes } = generateRecoveryCodes();

    user.twoFactor.secret = pending;
    user.twoFactor.pendingSecret = '';
    user.twoFactor.enabled = true;
    user.twoFactor.recoveryCodeHashes = hashes;
    user.twoFactor.enrolledAt = new Date();
    // The slot just used is spent, so the code that enabled 2FA cannot immediately be used
    // again to sign in.
    user.twoFactor.lastUsedStep = result.step;
    await user.save();

    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: user._id,
      performedBy: req.user._id,
      after: { changed: 'two-factor authentication enabled', recoveryCodes: codes.length },
    });
    logEvent('two_factor_enabled', { rid: req.id, userId: String(user._id) });

    res.json({
      ok: true,
      user: toDTO(user),
      recoveryCodes: codes,
      recoveryCodesNotice:
        'Write these down and keep them somewhere other than the phone. Each one works once, and they are the only way in if the phone is lost.',
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/me/2fa/disable (admin+) — turn it off.
//
// Needs the password *and* a live code, not one or the other. Either alone is a single
// thing a thief with a borrowed phone already has: the password is in his notes, or the
// authenticator app is unlocked on the same phone he is holding.
async function disableTwoFactor(req, res, next) {
  try {
    const { password, code } = req.body || {};
    if (!password || !code) {
      return res.status(400).json({ message: 'Your password and a current code are both required' });
    }

    const user = await User.findById(req.user._id).select(
      '+password +twoFactor.secret +twoFactor.recoveryCodeHashes'
    );
    if (!user.twoFactor?.enabled) {
      return res.status(400).json({ message: 'Two-factor authentication is not on for this account' });
    }
    if (!(await bcrypt.compare(String(password), user.password))) {
      return res.status(401).json({ message: 'Your password is not right' });
    }

    const result = verifyTotp(user.twoFactor.secret, code, { lastUsedStep: user.twoFactor.lastUsedStep });
    const recoveryRemaining = result.ok
      ? null
      : matchRecoveryCode(code, user.twoFactor.recoveryCodeHashes || []);
    if (!result.ok && !recoveryRemaining) {
      logLoginFailure({ email: user.email, ip: req.ip, rid: req.id, reason: 'wrong_2fa_code_on_disable' });
      return res.status(401).json({ message: 'That code is not right' });
    }

    user.twoFactor.enabled = false;
    user.twoFactor.secret = '';
    user.twoFactor.pendingSecret = '';
    user.twoFactor.recoveryCodeHashes = [];
    user.twoFactor.enrolledAt = null;
    user.twoFactor.lastUsedStep = null;
    await user.save();

    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: user._id,
      performedBy: req.user._id,
      after: { changed: 'two-factor authentication disabled' },
    });
    // Warning level: turning a second factor off makes the books easier to reach, and it
    // should be visible in the log without anybody going looking for it.
    logEvent('two_factor_disabled', { rid: req.id, userId: String(user._id) }, 'warn');

    res.json({ ok: true, user: toDTO(user) });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/admins/:id/2fa/reset (super_admin, admin) — the lost-phone door.
//
// Behind the same rule as every other admin action: a plain admin may only touch a
// secretary or disciplinary account. This clears the second factor entirely, so the
// account signs in with a password again — which is why it is loud in the audit trail and
// why whoever does it should reset that password at the same time.
async function resetAdminTwoFactor(req, res, next) {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Admin not found' });
    if (String(target._id) === String(req.user._id)) {
      return res.status(400).json({ message: 'Use "Turn off" on your own account instead' });
    }
    if (req.user.role === 'admin' && !['secretary', 'disciplinary'].includes(target.role)) {
      return res.status(403).json({ message: 'You can only manage secretary and disciplinary accounts' });
    }

    const wasEnabled = Boolean(target.twoFactor?.enabled);
    target.twoFactor.enabled = false;
    target.twoFactor.secret = '';
    target.twoFactor.pendingSecret = '';
    target.twoFactor.recoveryCodeHashes = [];
    target.twoFactor.enrolledAt = null;
    target.twoFactor.lastUsedStep = null;
    await target.save();

    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: target._id,
      performedBy: req.user._id,
      after: {
        changed: 'two-factor authentication reset by another admin (lost device)',
        wasEnabled,
        for: target.email,
      },
    });

    res.json({ ok: true, user: toDTO(target), wasEnabled });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/me/2fa/recovery-codes (admin+) — issue a fresh set.
//
// Ten codes get used up: one per lost phone, one per dead battery at the wrong moment. The
// alternative to this endpoint is asking another admin to switch the second factor off and
// on again, which leaves a window with no second factor at all and puts the recovery in
// somebody else's hands. Needs the password and a live code, like disabling does.
async function regenerateRecoveryCodes(req, res, next) {
  try {
    const { password, code } = req.body || {};
    if (!password || !code) {
      return res.status(400).json({ message: 'Your password and a current code are both required' });
    }
    if (!(await twoFactorInUse())) {
      return res.status(403).json({ message: 'Two-factor authentication is switched off for this group.' });
    }

    const user = await User.findById(req.user._id).select(
      '+password +twoFactor.secret +twoFactor.recoveryCodeHashes'
    );
    if (!user.twoFactor?.enabled) {
      return res.status(400).json({ message: 'Two-factor authentication is not on for this account' });
    }
    if (!(await bcrypt.compare(String(password), user.password))) {
      return res.status(401).json({ message: 'Your password is not right' });
    }

    const result = verifyTotp(user.twoFactor.secret, code, { lastUsedStep: user.twoFactor.lastUsedStep });
    if (!result.ok) {
      logLoginFailure({ email: user.email, ip: req.ip, rid: req.id, reason: 'wrong_2fa_code_on_recovery_issue' });
      return res.status(401).json({ message: 'That code is not right' });
    }

    const { codes, hashes } = generateRecoveryCodes();
    user.twoFactor.recoveryCodeHashes = hashes;
    user.twoFactor.lastUsedStep = result.step;
    await user.save();

    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: user._id,
      performedBy: req.user._id,
      after: { changed: 'recovery codes reissued', recoveryCodes: codes.length },
    });

    res.json({
      ok: true,
      recoveryCodes: codes,
      recoveryCodesNotice:
        'These replace the old set, which no longer works. Write them down and store them away from the phone.',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login,
  verifyTwoFactor,
  me,
  changeOwnPassword,
  beginTwoFactorSetup,
  enableTwoFactor,
  disableTwoFactor,
  regenerateRecoveryCodes,
  resetAdminTwoFactor,
  listAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
};

