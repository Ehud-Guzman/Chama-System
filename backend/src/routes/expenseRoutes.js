const router = require('express').Router();
const { listExpenses, createExpense, deleteExpense } = require('../controllers/expenseController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', listExpenses);
router.post('/', createExpense);
router.delete('/:id', deleteExpense);

module.exports = router;
