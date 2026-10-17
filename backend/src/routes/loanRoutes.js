const router = require('express').Router();
const {
  listLoans,
  getLoan,
  loanFunds,
  markLoanFund,
  createLoan,
  recordRepayment,
  undoLastRepayment,
  cancelLoan,
} = require('../controllers/loanController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { periodLock } = require('../middleware/periodLock');

// Loans are money: the same people who log money in and out keep them. Lending, and a repayment, are
// held by the closed-books lock like any other money dated in a closed period.
router.use(requireAuth, requireRole('super_admin', 'admin', 'treasurer'));

router.get('/', listLoans);
router.get('/funds', loanFunds);
// Which fund counts as "out on loan" is a decision about how the books read, so it is the admin's.
router.post('/funds/:id/mark-loan-fund', requireRole('super_admin', 'admin'), markLoanFund);
router.get('/:id', getLoan);
router.post('/', periodLock('body'), createLoan);
router.post('/:id/repayments', periodLock('body'), recordRepayment);
router.delete('/:id/repayments/last', periodLock('loanLastRepayment'), undoLastRepayment);
router.post('/:id/cancel', periodLock('loan'), cancelLoan);

module.exports = router;
