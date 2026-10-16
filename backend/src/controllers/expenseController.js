const mongoose = require('mongoose');
const { isAfterToday } = require('../utils/futureDate');
const Expense = require('../models/Expense');
const ContributionType = require('../models/ContributionType');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { fundBalance } = require('../utils/fundBalance');
const { computeMoneyPosition } = require('../utils/moneyPosition');
const {
  buildExpenseReport,
  renderExpenseReportPdf,
  expenseReportSheets,
} = require('../utils/expenseReport');
const { getOrCreateSettings } = require('../utils/settings');
const { sendWorkbook } = require('../utils/xlsxExport');

// Every expense on the books, newest first, with the fund and the person who logged
// it resolved. One loader, so the list, the report and the export can never be
// reading three slightly different things.
function loadExpenses() {
  return Expense.find({ deleted: false })
    .sort({ date: -1, createdAt: -1 })
    .populate('typeId', 'name isRecoverable')
    .populate('loggedBy', 'name')
    .lean();
}

// The funds money can actually be spent from — the ones flagged tracksExpenses on
// Finance -> Setup. This is what a screen offers in its fund picker, and it is
// narrowed here rather than in each screen so "which funds can be spent from" has
// exactly one answer.
function spendingFunds(position) {
  return (position.funds || [])
    .filter((f) => f.tracksExpenses)
    .map((f) => ({
      id: String(f.typeId || ''),
      name: f.name,
      isRecoverable: f.isRecoverable,
      carriedIn: f.carriedIn,
      contributed: f.collected,
      derived: f.derived,
      spent: f.spent,
      balance: f.balance,
    }));
}

// GET /api/expenses?typeId=
async function listExpenses(req, res, next) {
  try {
    const typeId = req.query.typeId;
    if (typeId && !mongoose.Types.ObjectId.isValid(typeId)) {
      return res.status(400).json({ message: 'Invalid contribution type id' });
    }
    const filter = { deleted: false };
    if (typeId) filter.typeId = typeId;

    const expenses = await Expense.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .populate('typeId', 'name')
      .populate('loggedBy', 'name')
      .lean();

    // The fund's own carry-in counts toward what it can spend: a balance check
    // that ignored the money the fund already held would wrongly refuse a payout.
    const type = typeId
      ? await ContributionType.findById(typeId).select('openingBalance').lean()
      : null;
    const balance = typeId ? await fundBalance(typeId, { carriedIn: type?.openingBalance }) : null;

    // The funds that can be spent from and what each holds, so a screen that logs an
    // expense has its picker and its balances without a second request.
    const position = await computeMoneyPosition();
    const funds = spendingFunds(position).map((f) => ({
      ...f,
      // fundBalance() already counted this fund's rows; the id is what a caller needs.
      id: f.id || String(f._id || ''),
    }));

    res.json({ expenses, balance, funds });
  } catch (err) {
    next(err);
  }
}

// Which pot is paying. Omitted means a fund, which is what every request meant before
// the group's total money could pay for anything.
function readSource(value) {
  return value === 'group' ? 'group' : 'fund';
}

const ksh = (n) => `Ksh ${Number(n || 0).toLocaleString('en-KE')}`;

// What the pot an expense is charged to holds right now, and whether this expense would take more
// than that. A fund holds its own balance; a group purchase comes off the group's total money — the
// same two figures the expenses screen shows beside the form.
//
// `current` is the expense being corrected, if any: its own amount is already off the pot, so it is
// given back before the new one is compared, and a correction that does not take more than it did
// (a reworded description, a smaller amount) is never held up for money that was already spent.
async function overdrawn({ source, typeId, amount, current = null }) {
  const position = await computeMoneyPosition();
  let available;
  let pot;
  if (source === 'group') {
    available = position.netBalance;
    pot = "the group's total money";
  } else {
    const fund = (position.funds || []).find((f) => String(f.typeId) === String(typeId));
    if (fund) {
      available = fund.balance;
      pot = fund.name;
    } else {
      const type = await ContributionType.findById(typeId).select('name openingBalance').lean();
      available = (await fundBalance(typeId, { carriedIn: type?.openingBalance })).balance;
      pot = type?.name || 'that fund';
    }
  }

  let gives = 0;
  let takesMore = true;
  if (current) {
    const samePot =
      current.source === source && (source === 'group' || String(current.typeId) === String(typeId));
    if (samePot) {
      gives = Number(current.amount) || 0;
      takesMore = amount > gives;
    }
  }
  const room = Math.round((available + gives) * 100) / 100;
  const shortfall = Math.round((amount - room) * 100) / 100;
  return { overdraws: takesMore && shortfall > 0, shortfall, available: room, pot };
}

// The refusal sent when an expense would take more than its pot holds and the treasurer has not
// ticked that they know. A 409 with a code, so the screen can tell it from any other refusal.
function overdrawRefusal(check) {
  return {
    code: 'OVERDRAW',
    message:
      `That is ${ksh(check.shortfall)} more than ${check.pot} holds (${ksh(check.available)}). ` +
      'Tick the box to record it anyway.',
    available: check.available,
    shortfall: check.shortfall,
  };
}

// POST /api/expenses
async function createExpense(req, res, next) {
  try {
    const { source, typeId, amount, date, description, reference, note } = req.body || {};
    const from = readSource(source);

    let type = null;
    if (from === 'fund') {
      type = await ContributionType.findById(typeId);
      if (!type || !type.tracksExpenses) {
        return res.status(400).json({ message: 'Contribution type not found or does not track expenses' });
      }
    } else if (!String(description || '').trim()) {
      // A group purchase names no fund, so what it was for is the only thing that says
      // what the money bought. Without it the entry is a figure and nothing else.
      return res.status(400).json({ message: 'Say what the group bought with it' });
    }

    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ message: 'Amount must be a number greater than zero' });
    }
    // A date in the future is almost always a mistyped year, and it would put the
    // spending in a month that has not happened — the one mistake in this form that
    // silently skews every report.
    const when = date ? new Date(date) : new Date();
    if (Number.isNaN(when.getTime())) return res.status(400).json({ message: 'Invalid date' });
    if (isAfterToday(when)) {
      return res.status(400).json({ message: 'Date cannot be in the future' });
    }

    // More than the pot holds is allowed, but only when the treasurer has said they know.
    const check = await overdrawn({ source: from, typeId: type?._id, amount: n });
    const confirmed = req.body?.confirmOverdraw === true;
    if (check.overdraws && !confirmed) return res.status(409).json(overdrawRefusal(check));

    const expense = await Expense.create({
      source: from,
      typeId: from === 'fund' ? type._id : null,
      amount: n,
      date: when,
      description: String(description || '').trim(),
      reference: String(reference || '').trim(),
      note: String(note || '').trim(),
      loggedBy: req.user._id,
    });

    await logAudit({
      action: 'create',
      entityType: 'Expense',
      entityId: expense._id,
      performedBy: req.user._id,
      // A confirmed overdraw is written into the trail, so "who let it go past what the fund held?"
      // has an answer.
      after: check.overdraws
        ? { ...snapshot(expense), overdrawConfirmed: { shortfall: check.shortfall, available: check.available } }
        : snapshot(expense),
    });

    const populated = await Expense.findById(expense._id)
      .populate('typeId', 'name')
      .populate('loggedBy', 'name')
      .lean();
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
    // What it was charged to and for how much before this correction, for the overdraw check.
    const current = { source: expense.source || 'fund', typeId: expense.typeId, amount: expense.amount };

    const { source, typeId, amount, date, description, reference, note } = req.body || {};
    // The pot can be corrected too: money recorded against a fund that was really the
    // group's own, or the other way round, is the other mistake this form exists to fix.
    if (source !== undefined || typeId !== undefined) {
      const from = readSource(source === undefined ? expense.source : source);
      if (from === 'group') {
        expense.source = 'group';
        expense.typeId = null;
      } else {
        const id = typeId === undefined || typeId === null || typeId === '' ? expense.typeId : typeId;
        const type = id ? await ContributionType.findById(id) : null;
        if (!type || !type.tracksExpenses) {
          return res
            .status(400)
            .json({ message: 'Contribution type not found or does not track expenses' });
        }
        expense.source = 'fund';
        expense.typeId = type._id;
      }
    }
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
      if (isAfterToday(d)) return res.status(400).json({ message: 'Date cannot be in the future' });
      expense.date = d;
    }
    if (description !== undefined) expense.description = String(description).trim();
    if (reference !== undefined) expense.reference = String(reference).trim();
    if (note !== undefined) expense.note = String(note).trim();

    // A group purchase names no fund, so what it was for is the only thing that says what
    // the money bought. The check is here rather than in the branch above so it also
    // catches a correction that clears the description on an entry already sourced from
    // the group's total money.
    if (expense.source === 'group' && !expense.description) {
      return res.status(400).json({ message: 'Say what the group bought with it' });
    }

    const check = await overdrawn({
      source: expense.source || 'fund',
      typeId: expense.typeId,
      amount: expense.amount,
      current,
    });
    if (check.overdraws && req.body?.confirmOverdraw !== true) {
      return res.status(409).json(overdrawRefusal(check));
    }

    await expense.save();
    await logAudit({
      action: 'update',
      entityType: 'Expense',
      entityId: expense._id,
      performedBy: req.user._id,
      before,
      after: check.overdraws
        ? { ...snapshot(expense), overdrawConfirmed: { shortfall: check.shortfall, available: check.available } }
        : snapshot(expense),
    });
    const populated = await Expense.findById(expense._id)
      .populate('typeId', 'name')
      .populate('loggedBy', 'name')
      .lean();
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

// GET /api/expenses/summary — the screen's figures and the report's raw material in
// one answer: what the group holds, how each fund stands, the spend by month, and
// every expense flattened for a table. One builder (utils/expenseReport
// buildExpenseReport) feeds this and the PDF, so the screen and the document cannot
// quote different totals.
async function expenseSummary(req, res, next) {
  try {
    const [expenses, position] = await Promise.all([loadExpenses(), computeMoneyPosition()]);
    const report = buildExpenseReport({ expenses, position, preparedBy: req.user?.name || '' });

    res.json({
      expenses: report.rows,
      funds: spendingFunds(position),
      money: report.money,
      // The group's own funds added up, spending already off them — the total a
      // meeting means by "the fund". Sent on its own as well as inside `money` so a
      // screen does not have to know its way around the report.
      groupFund: report.money.groupFund,
      summary: report.summary,
      byFund: report.byFund,
      byMonth: report.byMonth,
      generatedAt: report.generatedAt,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/expenses/export?format=pdf|xlsx — the same record as a document to hand
// over: a page per question in a meeting, or a workbook the office can sort.
async function exportExpenses(req, res, next) {
  try {
    const [expenses, position, settings] = await Promise.all([
      loadExpenses(),
      computeMoneyPosition(),
      getOrCreateSettings(),
    ]);
    const report = buildExpenseReport({ expenses, position, preparedBy: req.user?.name || '' });

    const format = String(req.query.format || 'pdf').toLowerCase();
    if (format === 'xlsx' || format === 'excel') {
      return sendWorkbook(res, 'expenses.xlsx', expenseReportSheets(report, settings.chamaName));
    }
    return renderExpenseReportPdf(res, report, settings.chamaName);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  expenseSummary,
  exportExpenses,
};
