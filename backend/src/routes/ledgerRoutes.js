const router = require('express').Router();
const {
  listLedger,
  memberLedger,
  createLog,
  collectWeek,
  undoCollectWeek,
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
// A whole week collected for everybody at once — the one-time week-91 entry —
// with a dry run and an undo, because it is the one bulk write in the system.
router.post('/collect-week', collectWeek);
router.delete('/collect-week', undoCollectWeek);
router.get('/members/:id', memberLedger);
router.post('/members/:id/log', createLog);

module.exports = router;
