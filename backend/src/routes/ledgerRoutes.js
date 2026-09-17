const router = require('express').Router();
const {
  listLedger,
  memberLedger,
  createLog,
  getSetup,
  updateSetup,
} = require('../controllers/ledgerController');
const { requireAuth, requireRole } = require('../middleware/auth');

// The treasurer's whole workspace: the member list, each member's ledger, the
// one write that logs anything, and the go-live setup. Admin and super admin
// keep access so one person being unavailable never blocks a Thursday close.
router.use(requireAuth, requireRole('super_admin', 'admin', 'treasurer'));

router.get('/', listLedger);
router.get('/setup', getSetup);
router.patch('/setup', updateSetup);
router.get('/members/:id', memberLedger);
router.post('/members/:id/log', createLog);

module.exports = router;
