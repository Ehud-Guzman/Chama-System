const router = require('express').Router();
const { downloadBackup } = require('../controllers/backupController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('super_admin'));

router.get('/', downloadBackup);

module.exports = router;
