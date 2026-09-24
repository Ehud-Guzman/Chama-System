const router = require('express').Router();
const {
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  expenseSummary,
  exportExpenses,
} = require('../controllers/expenseController');
const { requireAuth, requireRole } = require('../middleware/auth');

// Whoever keeps the books keeps the spending: the treasurer records what leaves the
// funds and the admin may too, and both can correct or remove an entry — every one of
// those writes lands in the audit trail. Nobody else sees this screen at all.
router.use(requireAuth, requireRole('super_admin', 'admin', 'treasurer'));

router.get('/', listExpenses);
// The report and its document. Declared before '/:id' would matter for GET only;
// these two are their own paths, so there is no id route to shadow them.
router.get('/summary', expenseSummary);
router.get('/export', exportExpenses);
router.post('/', createExpense);
router.patch('/:id', updateExpense);
router.delete('/:id', deleteExpense);

module.exports = router;
