const router = require('express').Router();
const { jobStatus, runJobNow } = require('../controllers/jobController');
const { requireAuth, requireRole } = require('../middleware/auth');

// Super admin only, matching the backup endpoint: this screen shows what is in the backup
// directory and can write a fresh copy of the whole database, which is the same authority the
// download button already has.
router.use(requireAuth, requireRole('super_admin'));

// What the scheduled jobs are, when they run next, and what they last did.
router.get('/', jobStatus);

// Run one now. Same code as the timer, so "run it by hand" is a real rehearsal of the schedule.
router.post('/:name/run', runJobNow);

module.exports = router;
