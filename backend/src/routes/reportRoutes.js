const router = require('express').Router();
const { summary, exportContributions, auditLog } = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/summary', summary);
router.get('/export', exportContributions);
router.get('/audit-log', auditLog);

module.exports = router;
