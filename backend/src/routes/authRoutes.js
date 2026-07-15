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
const { loginLimiter } = require('../middleware/rateLimiter');

router.post('/login', loginLimiter, login);
router.get('/me', requireAuth, me);
router.patch('/me/password', requireAuth, changeOwnPassword);
router.get('/admins', requireAuth, requireRole('super_admin'), listAdmins);
router.post('/admins', requireAuth, requireRole('super_admin'), createAdmin);
router.patch('/admins/:id', requireAuth, requireRole('super_admin'), updateAdmin);
router.post('/admins/:id/reset-password', requireAuth, requireRole('super_admin'), resetAdminPassword);

module.exports = router;
