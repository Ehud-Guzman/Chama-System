// The sign-in controller, part: signIn. controllers/authController.js is the index the routes use.

const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const { recordLoginFailure } = require('../../utils/securityEvents');
const { logEvent } = require('../../middleware/requestLogger');
const { matchRecoveryCode, verifyTotp } = require('../../utils/totp');
const { logAudit } = require('../../utils/auditLogger');
const { getOrCreateSettings } = require('../../utils/settings');
const { DUMMY_PASSWORD_HASH, readChallenge, recordFailedSignIn, recordSignIn, signChallenge, signToken, toDTO, twoFactorInUse, weakPasswordMessage } = require('./common');

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
      void recordLoginFailure({
        email: address,
        ip: req.ip,
        rid: req.id,
        reason: user ? 'wrong_password' : 'no_such_account',
        user,
      });
      await recordFailedSignIn(user);
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (!user.active) {
      void recordLoginFailure({ email: address, ip: req.ip, rid: req.id, reason: 'deactivated', user });
      return res.status(401).json({ message: 'This account has been deactivated' });
    }
    // Only said to somebody who has proved the password: a frozen account's existence is no secret
    // to its owner, and the reason is what they need to go and ask about.
    if (user.frozenAt) {
      void recordLoginFailure({ email: address, ip: req.ip, rid: req.id, reason: 'frozen', user });
      return res.status(401).json({
        message: user.frozenReason
          ? `This account is frozen: ${user.frozenReason}`
          : 'This account has been frozen. Ask the super admin.',
      });
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
    await recordSignIn(user, req);
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
      await recordSignIn(user, req);
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
      void recordLoginFailure({ email: user.email, ip: req.ip, rid: req.id, reason: 'wrong_2fa_code', user });
      await recordFailedSignIn(user);
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
    await recordSignIn(user, req);
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
  // The maintenance banner rides along: every signed-in screen needs to know the books are
  // read-only right now, and this is the one call every one of them already makes.
  let maintenance = null;
  try {
    const settings = await getOrCreateSettings();
    if (settings?.maintenanceMode) {
      maintenance = {
        message: settings.maintenanceMessage || '',
        since: settings.maintenanceSince || null,
      };
    }
  } catch {
    // Settings unreadable this instant: no banner is better than a failed /me.
  }
  res.json({
    user: req.previewing ? { ...toDTO(req.user), role: req.previewing } : toDTO(req.user),
    twoFactorAuthEnabled: await twoFactorInUse(),
    maintenance,
    // Set only while the super admin is looking at the app as another role (read-only).
    preview: req.previewing
      ? { role: req.previewing, realName: req.realUser?.name || '' }
      : null,
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

module.exports = {
  changeOwnPassword,
  login,
  me,
  verifyTwoFactor,
};
