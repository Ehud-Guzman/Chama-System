const router = require('express').Router();
const { login, me, listAdmins, createAdmin, updateAdmin } = require('../controllers/authController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.post('/login', login);
router.get('/me', requireAuth, me);
router.get('/admins', requireAuth, requireRole('super_admin'), listAdmins);
router.post('/admins', requireAuth, requireRole('super_admin'), createAdmin);
router.patch('/admins/:id', requireAuth, requireRole('super_admin'), updateAdmin);

module.exports = router;
