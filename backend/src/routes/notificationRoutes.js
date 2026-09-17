const router = require('express').Router();
const { mailStatus, listReminders, sendReminders } = require('../controllers/notificationController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// Sending mail is a treasurer/admin action; the secretary's read-only role has
// no business here (reports already show who is behind).
router.use(requireRole('super_admin', 'admin', 'treasurer'));

router.get('/status', mailStatus);
router.get('/reminders', listReminders);
router.post('/reminders', sendReminders);

module.exports = router;