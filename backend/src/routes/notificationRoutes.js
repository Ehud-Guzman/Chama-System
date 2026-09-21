const router = require('express').Router();
const {
  mailStatus,
  listReminders,
  sendReminders,
  sendTestEmail,
} = require('../controllers/notificationController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// Sending mail is a treasurer/admin action; the secretary's read-only role has
// no business here (reports already show who is behind).
router.use(requireRole('super_admin', 'admin', 'treasurer'));

router.get('/status', mailStatus);
router.get('/reminders', listReminders);
router.post('/reminders', sendReminders);
// One message, to the signed-in account's own address: the only way to answer "is it
// sending at all?" without a member being involved. Same role gate as the rest of this
// file, so a treasurer can check the group's own mail as readily as an admin.
router.post('/test', sendTestEmail);

module.exports = router;