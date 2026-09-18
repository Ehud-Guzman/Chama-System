const router = require('express').Router();
const {
  listFines,
  exportMemberFines,
  createFine,
  settleFine,
  voidFine,
} = require('../controllers/fineController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// The disciplinary officer reads and issues his own category of fines — the
// controller narrows every read of his to disciplinary-category types — and can
// export one member's whole record as a document. Settling and voiding stay with
// the office, and only the office sees financial fines.
router.get('/', requireRole('super_admin', 'admin', 'disciplinary'), listFines);
router.get(
  '/member/:memberId/export',
  requireRole('super_admin', 'admin', 'disciplinary'),
  exportMemberFines
);
router.post('/', requireRole('super_admin', 'admin', 'disciplinary'), createFine);
router.post('/:id/settle', requireRole('super_admin', 'admin'), settleFine);
router.delete('/:id', requireRole('super_admin', 'admin'), voidFine);

module.exports = router;
