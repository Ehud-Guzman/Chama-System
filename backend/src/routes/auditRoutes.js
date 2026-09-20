const router = require('express').Router();
const { list, exportList } = require('../controllers/auditController');
const { requireAuth, requireRole } = require('../middleware/auth');

// The audit trail is its own destination now, not a panel at the foot of the
// reports screen. The guard is the same set of roles that could already read it
// from there: a record of who did what is what a committee, a treasurer and a
// secretary all have a reason to read.
router.use(requireAuth, requireRole('super_admin', 'admin', 'treasurer', 'secretary'));

router.get('/', list);
// The same trail, filtered the same way, as a workbook — the sheet a committee
// meeting can hold and an external audit can be handed.
router.get('/export', exportList);

module.exports = router;
