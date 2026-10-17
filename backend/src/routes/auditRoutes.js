const router = require('express').Router();
const { list, exportList, oversight, attention, markReviewed, verify } = require('../controllers/auditController');
const { requireAuth, requireRole } = require('../middleware/auth');

// The audit trail is its own destination now, not a panel at the foot of the
// reports screen, and it is for the admins only. A record of who did what is read
// by the people who answer for the office; the treasurer and the secretary, whose
// own work it records, do not read it (they used to; the group withdrew that).
router.use(requireAuth, requireRole('super_admin', 'admin'));

router.get('/', list);
// The same trail, filtered the same way, as a workbook — the sheet a committee
// meeting can hold and an external audit can be handed.
router.get('/export', exportList);

// What only the super admin may see: how the officers behave, how well their accounts are
// protected, and whether the trail itself has been tampered with. The admin who is being
// watched is not the person who gets to run the watch.
router.get('/oversight', requireRole('super_admin'), oversight);
router.get('/attention', requireRole('super_admin'), attention);
router.post('/attention/reviewed', requireRole('super_admin'), markReviewed);
router.post('/verify', requireRole('super_admin'), verify);

module.exports = router;
