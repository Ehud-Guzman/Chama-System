const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const Member = require('../models/Member');
const Expense = require('../models/Expense');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const Counter = require('../models/Counter');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { toMoney } = require('../utils/money');
const { isAfterToday } = require('../utils/futureDate');
const { toEatDateString, parseEatDate } = require('../utils/weekCycle');
const { getOrCreateSettings } = require('../utils/settings');
const { computeMoneyPosition } = require('../utils/moneyPosition');
const { withOptionalTransaction } = require('../utils/fineAllocation');
const { approvalProblem } = require('../utils/expenseApproval');
const { validateTerms, splitRepayment, principalRepaidBy, standing } = require('../utils/loanMath');
const { overdrawn, overdrawRefusal, withExpenseLock, ensureLock } = require('./expenseController');

// Loans to members, out of a loan fund.
//
// Lending is an expense from a fund flagged as a loan fund (so the books count it as owed back, not
// spent); each repayment gives principal back by reducing that expense and records the interest as
// income. models/Loan explains why that keeps every existing figure right. The arithmetic is
// utils/loanMath, pure and tested to the cent; this file is the part that touches the books.

const METHODS = ['cash', 'bank', 'mobile', 'other'];
const SETTLED = 0.004;

class LoanError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.expose = true;
    this.extra = extra;
  }
}
const refuse = (res, err) => res.status(err.status).json({ message: err.message, ...(err.extra || {}) });

async function nextLoanNumber() {
  const updated = await Counter.findOneAndUpdate({ name: 'loanNumber' }, { $inc: { value: 1 } }, { upsert: true, new: true });
  return `LN-${String(updated.value).padStart(4, '0')}`;
}

const today = () => toEatDateString(new Date());

// A loan as the screen reads it: the terms, the people, and where it stands today.
function present(loan, { detail = false } = {}) {
  const issuedOn = toEatDateString(loan.issuedAt);
  const s = standing({
    principal: loan.principal,
    interestPercent: loan.interestPercent,
    termMonths: loan.termMonths,
    issuedOn,
    repayments: loan.repayments || [],
    today: today(),
  });
  const closed = loan.status !== 'active';
  const out = {
    id: String(loan._id),
    loanNumber: loan.loanNumber,
    status: loan.status,
    member: loan.memberId && loan.memberId._id
      ? { id: String(loan.memberId._id), name: loan.memberId.name, regNumber: loan.memberId.regNumber || '', phone: loan.memberId.phone || '' }
      : { id: String(loan.memberId || ''), name: '', regNumber: '', phone: '' },
    fund: loan.fundId && loan.fundId._id ? { id: String(loan.fundId._id), name: loan.fundId.name } : { id: String(loan.fundId || ''), name: '' },
    principal: s.principal,
    interestPercent: loan.interestPercent,
    termMonths: loan.termMonths,
    issuedOn,
    finalDueOn: s.finalDueOn,
    totalInterest: s.totalInterest,
    totalDue: s.totalDue,
    paid: s.paid,
    outstanding: closed ? 0 : s.outstanding,
    principalOutstanding: closed ? 0 : s.principalOutstanding,
    interestOutstanding: closed ? 0 : s.interestOutstanding,
    overdueAmount: closed ? 0 : s.overdueAmount,
    daysOverdue: closed ? 0 : s.daysOverdue,
    nextDue: closed ? null : s.nextDue,
    approvalRef: loan.approvalRef || '',
    note: loan.note || '',
    clearedAt: loan.clearedAt || null,
    cancelledReason: loan.cancelledReason || '',
    createdAt: loan.createdAt,
  };
  if (detail) {
    out.installments = s.installments;
    out.repayments = (loan.repayments || []).map((r, index) => ({
      index,
      amount: r.amount,
      principalPart: r.principalPart,
      interestPart: r.interestPart,
      date: r.date,
      method: r.method,
      note: r.note || '',
      by: r.recordedBy && r.recordedBy.name ? r.recordedBy.name : '',
    }));
  }
  return out;
}

const populateAll = (query) =>
  query.populate('memberId', 'name regNumber phone').populate('fundId', 'name').populate('repayments.recordedBy', 'name');

// GET /api/loans?status=active|cleared|cancelled|all&memberId=&q=
async function listLoans(req, res, next) {
  try {
    const status = ['active', 'cleared', 'cancelled'].includes(req.query.status) ? req.query.status : req.query.status === 'all' ? null : 'active';
    const filter = {};
    if (status) filter.status = status;
    if (req.query.memberId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.memberId)) return res.status(400).json({ message: 'Invalid member id' });
      filter.memberId = req.query.memberId;
    }
    let loans = (await populateAll(Loan.find(filter).sort({ issuedAt: -1, createdAt: -1 })).lean()).map((l) => present(l));
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) {
      loans = loans.filter((l) => `${l.member.name} ${l.member.regNumber} ${l.loanNumber}`.toLowerCase().includes(q));
    }

    // The group's loan book, over every loan that is still out (not just the page on screen).
    const live = (await Loan.find({ status: 'active' }).lean()).map((l) => present(l));
    const everything = await Loan.find({ status: { $ne: 'cancelled' } }).select('principal repayments.interestPart').lean();
    const summary = {
      active: live.length,
      lent: toMoney(live.reduce((sum, l) => sum + l.principal, 0)),
      principalOutstanding: toMoney(live.reduce((sum, l) => sum + l.principalOutstanding, 0)),
      outstanding: toMoney(live.reduce((sum, l) => sum + l.outstanding, 0)),
      overdueLoans: live.filter((l) => l.overdueAmount > 0).length,
      overdueAmount: toMoney(live.reduce((sum, l) => sum + l.overdueAmount, 0)),
      interestEarned: toMoney(everything.reduce((sum, l) => sum + (l.repayments || []).reduce((s, r) => s + (r.interestPart || 0), 0), 0)),
    };
    res.json({ loans, summary });
  } catch (err) {
    next(err);
  }
}

// GET /api/loans/:id
async function getLoan(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: 'Loan not found' });
    const loan = await populateAll(Loan.findById(req.params.id)).lean();
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    res.json({ loan: present(loan, { detail: true }) });
  } catch (err) {
    next(err);
  }
}

// GET /api/loans/funds — the funds a loan can come from, and the ones that could be made loan funds.
async function loanFunds(req, res, next) {
  try {
    const position = await computeMoneyPosition();
    const funds = (position.funds || [])
      .filter((f) => f.tracksExpenses)
      .map((f) => ({ id: String(f.typeId), name: f.name, isRecoverable: Boolean(f.isRecoverable), balance: f.balance, spent: f.spent }));
    res.json({ funds });
  } catch (err) {
    next(err);
  }
}

// POST /api/loans/funds/:id/mark-loan-fund { confirm: true } — admin and super admin.
//
// Flagging a fund as a loan fund changes how money ALREADY paid out of it is counted: it stops being
// "spent" and becomes "owed back", which raises what the group is shown as holding. That is a decision
// about the books, not a convenience, so it is refused until it has been confirmed with the figure in
// front of the person confirming.
async function markLoanFund(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: 'Fund not found' });
    const type = await ContributionType.findById(req.params.id);
    if (!type || !type.tracksExpenses) return res.status(404).json({ message: 'Fund not found, or it is not one money is spent from.' });
    if (type.isRecoverable) return res.json({ ok: true, alreadyLoanFund: true });

    const spentRows = await Expense.aggregate([
      { $match: { typeId: type._id, deleted: false } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const spent = toMoney(spentRows[0]?.total || 0);
    const count = spentRows[0]?.count || 0;
    if (req.body?.confirm !== true) {
      return res.status(409).json({
        code: 'NEEDS_CONFIRM',
        spent,
        count,
        message:
          count > 0
            ? `${count} payment${count === 1 ? '' : 's'} totalling Ksh ${spent.toLocaleString('en-KE')} already came out of ${type.name}. As a loan fund, that money will be counted as owed back instead of spent, so the group will show as holding Ksh ${spent.toLocaleString('en-KE')} more. Confirm only if those payments really were loans.`
            : `${type.name} has had nothing paid out of it yet, so marking it as a loan fund changes no figure.`,
      });
    }
    const before = snapshot(type);
    type.isRecoverable = true;
    await type.save();
    await logAudit({ action: 'update', entityType: 'ContributionType', entityId: type._id, performedBy: req.user._id, before, after: snapshot(type) });
    res.json({ ok: true, spent, count });
  } catch (err) {
    next(err);
  }
}

// POST /api/loans { memberId, fundId, principal, interestPercent, termMonths, date, note, approvalRef, confirmOverdraw }
async function createLoan(req, res, next) {
  try {
    const { memberId, fundId, principal, interestPercent, termMonths, date, note, approvalRef } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(String(memberId))) return res.status(400).json({ message: 'Choose the member.' });
    if (!mongoose.Types.ObjectId.isValid(String(fundId))) return res.status(400).json({ message: 'Choose the loan fund the money comes from.' });

    const member = await Member.findById(memberId).select('name regNumber active').lean();
    if (!member || !member.active) return res.status(400).json({ message: 'Member not found, or no longer a member.' });
    const fund = await ContributionType.findById(fundId);
    if (!fund || !fund.tracksExpenses || fund.active === false) {
      return res.status(400).json({ message: 'That fund cannot be lent from.' });
    }
    if (!fund.isRecoverable) {
      return res.status(400).json({
        message: `${fund.name} is not set up as a loan fund, so money lent from it would be counted as spent. Make it the loan fund first (Loans → New loan).`,
        code: 'NOT_LOAN_FUND',
      });
    }

    const termsProblem = validateTerms({ principal, interestPercent, termMonths });
    if (termsProblem) return res.status(400).json({ message: termsProblem });
    const amount = toMoney(principal);

    const issued = date ? new Date(date) : new Date();
    if (Number.isNaN(issued.getTime())) return res.status(400).json({ message: 'Invalid date' });
    if (isAfterToday(issued)) return res.status(400).json({ message: 'The date lent cannot be in the future.' });
    const issuedAt = parseEatDate(toEatDateString(issued));

    // A loan is spending the members may have to approve, so the group's spending limit applies to it.
    const approval = approvalProblem({ amount, approvalRef, limit: (await getOrCreateSettings()).expenseApprovalLimit });
    if (approval) return res.status(approval.status).json(approval.body);

    const confirmed = req.body?.confirmOverdraw === true;
    await ensureLock();
    const outcome = await withExpenseLock(async (session) => {
      const found = await overdrawn({ source: 'fund', typeId: fund._id, amount });
      if (found.overdraws && !confirmed) return { check: found };
      const loanNumber = await nextLoanNumber();
      const loanId = new mongoose.Types.ObjectId();
      const expenseId = new mongoose.Types.ObjectId();
      const [expense] = await Expense.create(
        [
          {
            _id: expenseId,
            loanId,
            source: 'fund',
            typeId: fund._id,
            amount,
            date: issuedAt,
            description: `Loan ${loanNumber} to ${member.name}`,
            reference: loanNumber,
            approvalRef: String(approvalRef || '').trim(),
            loggedBy: req.user._id,
          },
        ],
        { session }
      );
      const [loan] = await Loan.create(
        [
          {
            _id: loanId,
            loanNumber,
            memberId: member._id,
            fundId: fund._id,
            principal: amount,
            interestPercent: Number(interestPercent),
            termMonths: Number(termMonths),
            issuedAt,
            expenseId: expense._id,
            approvalRef: String(approvalRef || '').trim(),
            note: String(note || '').trim(),
            createdBy: req.user._id,
          },
        ],
        { session }
      );
      return { check: found, loan, expense };
    });
    if (!outcome.loan) return res.status(409).json(overdrawRefusal(outcome.check));

    await logAudit({ action: 'create', entityType: 'Loan', entityId: outcome.loan._id, performedBy: req.user._id, after: snapshot(outcome.loan) });
    await logAudit({ action: 'create', entityType: 'Expense', entityId: outcome.expense._id, performedBy: req.user._id, after: snapshot(outcome.expense) });

    const populated = await populateAll(Loan.findById(outcome.loan._id)).lean();
    res.status(201).json({ loan: present(populated, { detail: true }) });
  } catch (err) {
    if (err instanceof LoanError) return refuse(res, err);
    next(err);
  }
}

// POST /api/loans/:id/repayments { amount, date, method, note, clientRequestId }
async function recordRepayment(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: 'Loan not found' });
    const { amount, date, method = 'cash', note, clientRequestId } = req.body || {};
    const n = toMoney(amount);
    if (!Number.isFinite(Number(amount)) || n <= 0) return res.status(400).json({ message: 'The repayment must be more than zero.' });
    if (!METHODS.includes(method)) return res.status(400).json({ message: `Method must be one of: ${METHODS.join(', ')}` });
    const paidOn = date ? new Date(date) : new Date();
    if (Number.isNaN(paidOn.getTime())) return res.status(400).json({ message: 'Invalid date' });
    if (isAfterToday(paidOn)) return res.status(400).json({ message: 'The date paid cannot be in the future.' });
    const when = parseEatDate(toEatDateString(paidOn));
    const requestId = String(clientRequestId || '').slice(0, 100);

    const result = await withOptionalTransaction(async (session) => {
      const loan = await Loan.findById(req.params.id).session(session || null);
      if (!loan) throw new LoanError(404, 'Loan not found');
      if (requestId && loan.repayments.some((r) => r.requestId === requestId)) return { loan, replay: true };
      if (loan.status !== 'active') throw new LoanError(409, loan.status === 'cleared' ? 'That loan is already paid off.' : 'That loan was cancelled.');
      if (when < loan.issuedAt) throw new LoanError(400, 'A repayment cannot be dated before the loan was made.');

      const issuedOn = toEatDateString(loan.issuedAt);
      const s = standing({ principal: loan.principal, interestPercent: loan.interestPercent, termMonths: loan.termMonths, issuedOn, repayments: loan.repayments, today: today() });
      if (n > s.outstanding + SETTLED) {
        throw new LoanError(400, `That is more than is owed. The loan has Ksh ${s.outstanding.toLocaleString('en-KE')} left to repay.`, { outstanding: s.outstanding });
      }
      const before = snapshot(loan);
      const split = splitRepayment({ principal: loan.principal, totalDue: s.totalDue, paidBefore: s.paid, amount: n });

      // Interest is the group's income: it goes into the loan fund as money collected from the borrower.
      let contributionId = null;
      if (split.interestPart > 0) {
        const [row] = await Contribution.create(
          [
            {
              memberId: loan.memberId,
              typeId: loan.fundId,
              amount: split.interestPart,
              date: when,
              method,
              note: `Loan ${loan.loanNumber} interest`,
              loggedBy: req.user._id,
            },
          ],
          { session }
        );
        contributionId = row._id;
      }

      loan.repayments.push({ amount: n, principalPart: split.principalPart, interestPart: split.interestPart, date: when, method, note: String(note || '').trim(), recordedBy: req.user._id, contributionId, requestId });

      // Principal given back lowers what is out on loan: the disbursement's amount IS what is still owed.
      const paidAfter = toMoney(s.paid + n);
      const principalLeft = toMoney(loan.principal - principalRepaidBy(paidAfter, { principal: loan.principal, totalDue: s.totalDue }));
      const expense = await Expense.findById(loan.expenseId).session(session || null);
      if (expense) {
        expense.amount = principalLeft;
        expense.deleted = principalLeft <= SETTLED;
        await expense.save({ session });
      }
      if (toMoney(s.totalDue - paidAfter) <= SETTLED) {
        loan.status = 'cleared';
        loan.clearedAt = new Date();
      }
      await loan.save({ session });
      return { loan, before, split };
    });

    if (!result.replay) {
      await logAudit({ action: 'update', entityType: 'Loan', entityId: result.loan._id, performedBy: req.user._id, before: result.before, after: snapshot(result.loan) });
    }
    const populated = await populateAll(Loan.findById(result.loan._id)).lean();
    res.status(result.replay ? 200 : 201).json({ loan: present(populated, { detail: true }), ...(result.split ? { split: result.split } : {}), ...(result.replay ? { replay: true } : {}) });
  } catch (err) {
    if (err instanceof LoanError) return refuse(res, err);
    next(err);
  }
}

// DELETE /api/loans/:id/repayments/last — take back the most recent repayment.
//
// Only the latest: each repayment's split is worked from the running total, so removing one from the
// middle would change every later one. A mistake further back is corrected by taking the later ones
// back too, in order, which is also how a paper ledger is corrected.
async function undoLastRepayment(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: 'Loan not found' });
    const result = await withOptionalTransaction(async (session) => {
      const loan = await Loan.findById(req.params.id).session(session || null);
      if (!loan) throw new LoanError(404, 'Loan not found');
      if (loan.status === 'cancelled') throw new LoanError(409, 'That loan was cancelled.');
      if (loan.repayments.length === 0) throw new LoanError(400, 'There is no repayment to take back.');
      const before = snapshot(loan);
      const removed = loan.repayments[loan.repayments.length - 1];
      loan.repayments.pop();

      const totalDue = toMoney(loan.principal + (loan.principal * loan.interestPercent) / 100);
      const paidAfter = toMoney(loan.repayments.reduce((sum, r) => sum + r.amount, 0));
      const principalLeft = toMoney(loan.principal - principalRepaidBy(paidAfter, { principal: loan.principal, totalDue }));
      const expense = await Expense.findById(loan.expenseId).session(session || null);
      if (expense) {
        expense.amount = principalLeft;
        expense.deleted = false;
        await expense.save({ session });
      }
      if (removed.contributionId) {
        await Contribution.updateOne({ _id: removed.contributionId }, { $set: { deleted: true } }, { session });
      }
      loan.status = 'active';
      loan.clearedAt = null;
      await loan.save({ session });
      return { loan, before, removed };
    });
    await logAudit({
      action: 'update',
      entityType: 'Loan',
      entityId: result.loan._id,
      performedBy: req.user._id,
      before: result.before,
      after: { ...snapshot(result.loan), repaymentTakenBack: { amount: result.removed.amount, date: result.removed.date } },
    });
    const populated = await populateAll(Loan.findById(result.loan._id)).lean();
    res.json({ loan: present(populated, { detail: true }) });
  } catch (err) {
    if (err instanceof LoanError) return refuse(res, err);
    next(err);
  }
}

// POST /api/loans/:id/cancel { reason } — a loan made in error, before anything was repaid.
async function cancelLoan(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: 'Loan not found' });
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (reason.length < 3) return res.status(400).json({ message: 'Say why the loan is being cancelled.' });
    const result = await withOptionalTransaction(async (session) => {
      const loan = await Loan.findById(req.params.id).session(session || null);
      if (!loan) throw new LoanError(404, 'Loan not found');
      if (loan.status !== 'active') throw new LoanError(409, 'Only a loan that is still out can be cancelled.');
      if (loan.repayments.length > 0) {
        throw new LoanError(409, 'Repayments have already been made on it. Take them back first, or leave the loan as it is.');
      }
      const before = snapshot(loan);
      const expense = await Expense.findById(loan.expenseId).session(session || null);
      if (expense) {
        expense.deleted = true;
        await expense.save({ session });
      }
      loan.status = 'cancelled';
      loan.cancelledReason = reason;
      await loan.save({ session });
      return { loan, before };
    });
    await logAudit({ action: 'delete', entityType: 'Loan', entityId: result.loan._id, performedBy: req.user._id, before: result.before, after: snapshot(result.loan) });
    const populated = await populateAll(Loan.findById(result.loan._id)).lean();
    res.json({ loan: present(populated, { detail: true }) });
  } catch (err) {
    if (err instanceof LoanError) return refuse(res, err);
    next(err);
  }
}

// What the Control Room and the member's page need without loading the list: the group's loans that
// are behind, and the amount one member still owes.
async function loansSnapshot() {
  const live = (await Loan.find({ status: 'active' }).populate('memberId', 'name').lean()).map((l) => present(l));
  const overdue = live.filter((l) => l.overdueAmount > 0);
  return {
    active: live.length,
    outstanding: toMoney(live.reduce((sum, l) => sum + l.outstanding, 0)),
    overdueCount: overdue.length,
    overdueAmount: toMoney(overdue.reduce((sum, l) => sum + l.overdueAmount, 0)),
    overdue: overdue.slice(0, 5).map((l) => ({ id: l.id, loanNumber: l.loanNumber, member: l.member.name, overdueAmount: l.overdueAmount, daysOverdue: l.daysOverdue })),
  };
}

async function activeLoanOwedBy(memberId) {
  const live = (await Loan.find({ memberId, status: 'active' }).lean()).map((l) => present(l));
  return { count: live.length, outstanding: toMoney(live.reduce((sum, l) => sum + l.outstanding, 0)) };
}

module.exports = {
  listLoans,
  getLoan,
  loanFunds,
  markLoanFund,
  createLoan,
  recordRepayment,
  undoLastRepayment,
  cancelLoan,
  loansSnapshot,
  activeLoanOwedBy,
};
