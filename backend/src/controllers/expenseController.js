const Expense = require('../models/Expense');
const ContributionType = require('../models/ContributionType');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { fundBalance } = require('../utils/fundBalance');

// GET /api/expenses?typeId=
async function listExpenses(req, res, next) {
  try {
    const filter = { deleted: false };
    if (req.query.typeId) filter.typeId = req.query.typeId;

    const expenses = await Expense.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .populate('typeId', 'name')
      .populate('loggedBy', 'name')
      .lean();

    const balance = req.query.typeId ? await fundBalance(req.query.typeId) : null;
    res.json({ expenses, balance });
  } catch (err) {
    next(err);
  }
}

// POST /api/expenses
async function createExpense(req, res, next) {
  try {
    const { typeId, amount, date, description } = req.body || {};

    const type = await ContributionType.findById(typeId);
    if (!type || !type.tracksExpenses) {
      return res.status(400).json({ message: 'Contribution type not found or does not track expenses' });
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ message: 'Amount must be a number greater than zero' });
    }

    const expense = await Expense.create({
      typeId: type._id,
      amount: n,
      date: date ? new Date(date) : new Date(),
      description: String(description || '').trim(),
      loggedBy: req.user._id,
    });

    await logAudit({
      action: 'create',
      entityType: 'Expense',
      entityId: expense._id,
      performedBy: req.user._id,
      after: snapshot(expense),
    });

    const populated = await Expense.findById(expense._id).populate('typeId', 'name').lean();
    res.status(201).json({ expense: populated });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/expenses/:id — edit amount/date/description (e.g. correcting the
// tea/water expense once the actual cost is known)
async function updateExpense(req, res, next) {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense || expense.deleted) return res.status(404).json({ message: 'Expense not found' });
    const before = snapshot(expense);

    const { amount, date, description } = req.body || {};
    if (amount !== undefined) {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ message: 'Amount must be a number greater than zero' });
      }
      expense.amount = n;
    }
    if (date !== undefined && date !== null && date !== '') {
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid date' });
      expense.date = d;
    }
    if (description !== undefined) expense.description = String(description).trim();

    await expense.save();
    await logAudit({
      action: 'update',
      entityType: 'Expense',
      entityId: expense._id,
      performedBy: req.user._id,
      before,
      after: snapshot(expense),
    });
    const populated = await Expense.findById(expense._id).populate('typeId', 'name').lean();
    res.json({ expense: populated });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/expenses/:id — soft delete
async function deleteExpense(req, res, next) {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense || expense.deleted) return res.status(404).json({ message: 'Expense not found' });
    const before = snapshot(expense);

    expense.deleted = true;
    await expense.save();
    await logAudit({
      action: 'delete',
      entityType: 'Expense',
      entityId: expense._id,
      performedBy: req.user._id,
      before,
      after: snapshot(expense),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listExpenses, createExpense, updateExpense, deleteExpense };
