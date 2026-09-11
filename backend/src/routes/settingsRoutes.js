const router = require('express').Router();
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('super_admin', 'admin'));

router.get('/', getSettings);
router.patch('/', updateSettings);

module.exports = router;
