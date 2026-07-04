const router = require('express').Router();
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', getSettings);
router.patch('/', updateSettings);

module.exports = router;
