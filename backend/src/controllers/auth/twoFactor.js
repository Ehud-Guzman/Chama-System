// The sign-in controller, part: twoFactor. controllers/authController.js is the index the routes use.

const Settings = require('../../models/Settings');
const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const { generateSecret, otpauthUrl, verifyTotp, generateRecoveryCodes, matchRecoveryCode } = require('../../utils/totp');
const { logAudit } = require('../../utils/auditLogger');
const { logEvent, logLoginFailure } = require('../../middleware/requestLogger');
const { toDTO, twoFactorInUse } = require('./common');

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
  beginTwoFactorSetup,
  disableTwoFactor,
  enableTwoFactor,
  regenerateRecoveryCodes,
};
