const router = require('express').Router();
const {
  summary,
  exportContributions,
  auditLog,
  performance,
  exportPerformance,
  monthly,
  exportMonthly,
} = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/summary', summary);
router.get('/export', exportContributions);
router.get('/audit-log', auditLog);
router.get('/performance', performance);
router.get('/performance/export', exportPerformance);
router.get('/monthly', monthly);
router.get('/monthly/export', exportMonthly);

module.exports = router;
