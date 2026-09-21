const router = require('express').Router();
const { downloadBackup, backupStatus } = require('../controllers/backupController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('super_admin'));

router.get('/', downloadBackup);

// What the panel prints above and below the button: when a copy last left this machine, and what
// is on the host. Read-only, and behind the same guard as the download, since it describes the
// contents of the backup directory.
router.get('/status', backupStatus);

module.exports = router;
