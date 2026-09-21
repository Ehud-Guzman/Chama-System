const router = require('express').Router();
const {
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
} = require('../controllers/authController');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  loginLimiter,
  loginSprayLimiter,
  twoFactorLimiter,
  twoFactorSprayLimiter,
  passwordChangeLimiter,
} = require('../middleware/rateLimiter');

// The spray limiter runs first: it caps total attempts from one connection, so a
// script working through a list of addresses runs out even though each address has
// its own budget.
router.post('/login', loginSprayLimiter, loginLimiter, login);

// Step two of the sign-in. Public, because all the caller holds at this point is a
// five-minute challenge — which is not a session and is refused everywhere else.
// Budgeted per challenge and per connection (see middleware/rateLimiter).
router.post('/2fa/verify', twoFactorSprayLimiter, twoFactorLimiter, verifyTwoFactor);

router.get('/me', requireAuth, me);
router.patch('/me/password', requireAuth, passwordChangeLimiter, changeOwnPassword);

// Two-factor authentication on one's own account. Enrolment is three calls —
// setup, then enable with a code from the app — because nothing may switch on until
// the app has actually been shown to work.
router.post('/me/2fa/setup', requireAuth, beginTwoFactorSetup);
router.post('/me/2fa/enable', requireAuth, passwordChangeLimiter, enableTwoFactor);
router.post('/me/2fa/disable', requireAuth, passwordChangeLimiter, disableTwoFactor);
router.post('/me/2fa/recovery-codes', requireAuth, passwordChangeLimiter, regenerateRecoveryCodes);

router.get('/admins', requireAuth, requireRole('super_admin', 'admin'), listAdmins);
router.post('/admins', requireAuth, requireRole('super_admin', 'admin'), createAdmin);
router.patch('/admins/:id', requireAuth, requireRole('super_admin', 'admin'), updateAdmin);
router.post('/admins/:id/reset-password', requireAuth, requireRole('super_admin', 'admin'), resetAdminPassword);
// A lost or replaced phone. Same role rule as the other admin actions, and it leaves the
// loudest kind of audit entry.
router.post('/admins/:id/2fa/reset', requireAuth, requireRole('super_admin', 'admin'), resetAdminTwoFactor);

module.exports = router;
