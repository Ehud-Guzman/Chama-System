const router = require('express').Router();
const {
  summary,
  exportContributions,
  auditLog,
  performance,
  exportPerformance,
  monthly,
  exportMonthly,
  weekly,
  exportWeekly,
  memberReport,
} = require('../controllers/reportController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('super_admin', 'admin', 'treasurer', 'secretary'));

router.get('/summary', summary);
router.get('/export', exportContributions);
router.get('/audit-log', auditLog);
router.get('/performance', performance);
router.get('/performance/export', exportPerformance);
router.get('/monthly', monthly);
router.get('/monthly/export', exportMonthly);
router.get('/weekly', weekly);
router.get('/weekly/export', exportWeekly);
// One member's own figures — the chart a row in the performance list opens.
// Served from here rather than /api/members/:id so a secretary, who may read the
// reports but not the member records, can open the same chart.
router.get('/member/:id', memberReport);

module.exports = router;
