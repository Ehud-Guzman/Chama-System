const router = require('express').Router();
const {
  login,
  me,
  changeOwnPassword,
  listAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
} = require('../controllers/authController');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  loginLimiter,
  loginSprayLimiter,
  passwordChangeLimiter,
} = require('../middleware/rateLimiter');

// The spray limiter runs first: it caps total attempts from one connection, so a
// script working through a list of addresses runs out even though each address has
// its own budget.
router.post('/login', loginSprayLimiter, loginLimiter, login);
router.get('/me', requireAuth, me);
router.patch('/me/password', requireAuth, passwordChangeLimiter, changeOwnPassword);
router.get('/admins', requireAuth, requireRole('super_admin', 'admin'), listAdmins);
router.post('/admins', requireAuth, requireRole('super_admin', 'admin'), createAdmin);
router.patch('/admins/:id', requireAuth, requireRole('super_admin', 'admin'), updateAdmin);
router.post('/admins/:id/reset-password', requireAuth, requireRole('super_admin', 'admin'), resetAdminPassword);

module.exports = router;
