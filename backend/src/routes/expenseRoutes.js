const router = require('express').Router();
const { listExpenses, createExpense, updateExpense, deleteExpense } = require('../controllers/expenseController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('super_admin', 'admin'));

router.get('/', listExpenses);
router.post('/', createExpense);
router.patch('/:id', updateExpense);
router.delete('/:id', deleteExpense);

module.exports = router;
