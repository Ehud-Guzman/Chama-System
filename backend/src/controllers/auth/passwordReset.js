// The sign-in controller, part: passwordReset. controllers/authController.js is the index the routes use.

const crypto = require('crypto');
const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const { isMailConfigured, buildPasswordResetEmail, sendMail, describeMailError } = require('../../utils/mailer');
const { logEvent } = require('../../middleware/requestLogger');
const { getOrCreateSettings } = require('../../utils/settings');
const { logAudit } = require('../../utils/auditLogger');
const { weakPasswordMessage } = require('./common');

// ---------------------------------------------------------------------------------------------
// Forgotten passwords, by email
// ---------------------------------------------------------------------------------------------
//
// Until now the only way back in was another admin resetting your password for you, which leaves
// the last admin standing — or the only one — with nobody to ask. This is the self-service road,
// and it is built to be boring on purpose:
//
//   * The answer to "forgot password" is the same whether or not the address has an account, and
//     it is sent *before* anything is looked up or mailed, so neither the words nor the time it
//     took say which addresses hold accounts.
//   * The link carries a random token that exists in the email and nowhere else. Only its hash is
//     stored, it lasts thirty minutes, it works once, and asking again replaces it.
//   * It resets the password and nothing else. A second factor, if the account has one, is still
//     asked for at sign-in, so a mailbox alone is not a way round it.
//   * Using it ends every other session (passwordChangedAt), exactly like changing it by hand.
const RESET_MINUTES = 30;

const RESET_ANSWER =
  'If that address belongs to an account, a link to choose a new password is on its way. It works for 30 minutes.';

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

// Where the link points: the site itself. FRONTEND_URL lists every address the site answers on,
// the live one first in practice, and a localhost entry is only ever there for development.
function resetLinkBase() {
  const origins = String(process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return origins.find((origin) => !/localhost|127\.0\.0\.1/.test(origin)) || origins[0];
}

// GET /api/auth/password-reset/available — whether the sign-in page should offer the link at all.
// A link that sends nothing is worse than none: somebody would wait for an email that never comes.
function passwordResetAvailable(req, res) {
  res.json({ available: isMailConfigured() });
}

// POST /api/auth/forgot-password
async function forgotPassword(req, res) {
  // The same answer, first, whatever follows.
  res.json({ message: RESET_ANSWER });

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || email.length > 254) return;
  if (!isMailConfigured()) {
    logEvent('password_reset_skipped', { rid: req.id, reason: 'mail not configured' }, 'warn');
    return;
  }

  try {
    const user = await User.findOne({ email, active: true });
    if (!user) {
      logEvent('password_reset_unknown_address', { rid: req.id }, 'warn');
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          resetTokenHash: sha256(token),
          resetTokenExpires: new Date(Date.now() + RESET_MINUTES * 60 * 1000),
        },
      }
    );

    const settings = await getOrCreateSettings();
    const link = `${resetLinkBase()}/admin/reset-password?token=${token}`;
    const { subject, html, text } = buildPasswordResetEmail({
      chamaName: settings.chamaName,
      name: user.name,
      link,
      minutes: RESET_MINUTES,
    });
    await sendMail({ to: user.email, subject, html, text });

    logEvent('password_reset_sent', { rid: req.id, userId: String(user._id) });
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: user._id,
      performedBy: user._id,
      after: { passwordResetRequested: true },
    });
  } catch (err) {
    // The person has already been answered; the log is where a mail failure shows.
    logEvent('password_reset_failed', { rid: req.id, error: describeMailError(err) }, 'error');
  }
}

// POST /api/auth/reset-password { token, password }
async function resetPasswordWithToken(req, res, next) {
  try {
    const { token, password } = req.body || {};
    const weak = weakPasswordMessage(password);
    if (weak) return res.status(400).json({ message: weak });
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'This reset link is not valid. Ask for a new one.' });
    }

    const user = await User.findOne({
      resetTokenHash: sha256(token),
      resetTokenExpires: { $gt: new Date() },
      active: true,
    });
    if (!user) {
      logEvent('password_reset_refused', { rid: req.id }, 'warn');
      return res
        .status(400)
        .json({ message: 'This reset link has expired or was already used. Ask for a new one.' });
    }

    user.password = await bcrypt.hash(String(password), 10);
    // Ends every session older than this, the thief's included.
    user.passwordChangedAt = new Date();
    user.resetTokenHash = '';
    user.resetTokenExpires = null;
    await user.save();

    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: user._id,
      performedBy: user._id,
      after: { changed: 'password', via: 'email reset link' },
    });
    logEvent('password_reset_done', { rid: req.id, userId: String(user._id) });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  forgotPassword,
  passwordResetAvailable,
  resetPasswordWithToken,
};
