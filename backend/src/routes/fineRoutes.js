const router = require('express').Router();
const {
  listFines,
  finesSummary,
  exportFines,
  exportMemberFines,
  createFine,
  settleFine,
  payMemberFines,
  memberFinePosition,
  undoFinePayment,
  paymentsToCheck,
  checkPayments,
  voidFine,
} = require('../controllers/fineController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// The disciplinary officer reads and issues his own category of fines — the
// controller narrows every read of his to disciplinary-category types — and can
// export one member's whole record, or the group's, as a document. Settling and
// voiding stay with the office, and only the office sees financial fines.
router.get('/', requireRole('super_admin', 'admin', 'disciplinary'), listFines);
router.get('/summary', requireRole('super_admin', 'admin', 'disciplinary'), finesSummary);
router.get('/export', requireRole('super_admin', 'admin', 'disciplinary'), exportFines);
router.get(
  '/member/:memberId/export',
  requireRole('super_admin', 'admin', 'disciplinary'),
  exportMemberFines
);
router.post('/', requireRole('super_admin', 'admin', 'disciplinary'), createFine);

// Taking payment, and sorting out the ones recorded before payments said how they were made.
// Every one of these moves money, so every one is the office's alone: a payment can come off a
// member's balance, which the disciplinary officer has no part in.
router.get('/member/:memberId/position', requireRole('super_admin', 'admin'), memberFinePosition);
router.post('/member/:memberId/pay', requireRole('super_admin', 'admin'), payMemberFines);
router.get('/payments/to-check', requireRole('super_admin', 'admin'), paymentsToCheck);
router.post('/payments/check', requireRole('super_admin', 'admin'), checkPayments);
router.post('/:id/settle', requireRole('super_admin', 'admin'), settleFine);
router.post('/:id/payments/:index/undo', requireRole('super_admin', 'admin'), undoFinePayment);
router.delete('/:id', requireRole('super_admin', 'admin'), voidFine);

module.exports = router;
