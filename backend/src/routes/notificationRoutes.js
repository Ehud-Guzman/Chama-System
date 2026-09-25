const router = require('express').Router();
const {
  mailStatus,
  listReminders,
  sendReminders,
  reminderHistory,
} = require('../controllers/notificationController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// Sending mail is a treasurer/admin action; the secretary's read-only role has
// no business here (reports already show who is behind).
router.use(requireRole('super_admin', 'admin', 'treasurer'));

router.get('/status', mailStatus);
router.get('/reminders', listReminders);
router.post('/reminders', sendReminders);
// What has actually been sent, newest first — reminders and the two fine emails. A read of the
// audit trail rather than of a register of its own, so it cannot report a send that never
// happened or miss one that did.
router.get('/history', reminderHistory);

module.exports = router;