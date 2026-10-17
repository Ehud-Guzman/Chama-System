const { toMoney } = require('./money');

// The arithmetic of a member loan, as pure functions: no database, no clock of their own.
//
// The terms are the simple ones the group asked for. A loan has a principal, one flat interest rate
// charged once on that principal over the whole term, and equal monthly instalments. So:
//
//     interest = principal x rate / 100          (once, not per month)
//     total due = principal + interest
//     instalment = total due / months            (the last one absorbs the rounding)
//
// A repayment is split into the part that gives back principal and the part that is interest in the
// SAME proportion the loan was priced in. That is not a style choice: the books count the money a
// loan took out of a fund as owed back (not spent) and count interest as income, so every repayment
// has to say exactly how much of itself is which. The split is worked from the running total paid,
// not payment by payment, so however a borrower pays — in full instalments, in odd amounts, all at
// once — the principal and interest add up to exactly what was lent and exactly what was charged.

const MAX_TERM_MONTHS = 60;
const MAX_RATE = 100;

// 'YYYY-MM-DD' plus whole months, clamped to the end of a shorter month: a loan issued on the 31st
// falls due on the last day of February, not on the 3rd of March.
function addMonths(dateString, months) {
  const [y, m, d] = String(dateString).split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day)).toISOString().slice(0, 10);
}

function validateTerms({ principal, interestPercent, termMonths }) {
  const p = Number(principal);
  if (!Number.isFinite(p) || p <= 0) return 'The amount lent must be greater than zero.';
  const r = Number(interestPercent);
  if (!Number.isFinite(r) || r < 0 || r > MAX_RATE) return `Interest must be a percentage from 0 to ${MAX_RATE}.`;
  const t = Number(termMonths);
  if (!Number.isInteger(t) || t < 1 || t > MAX_TERM_MONTHS) {
    return `The repayment period must be a whole number of months from 1 to ${MAX_TERM_MONTHS}.`;
  }
  return null;
}

// What the loan costs and when it falls due. `issuedOn` is an EAT calendar date, 'YYYY-MM-DD'.
function buildSchedule({ principal, interestPercent, termMonths, issuedOn }) {
  const p = toMoney(principal);
  const totalInterest = toMoney((p * Number(interestPercent || 0)) / 100);
  const totalDue = toMoney(p + totalInterest);
  const each = toMoney(totalDue / termMonths);

  const installments = [];
  let sum = 0;
  for (let n = 1; n <= termMonths; n += 1) {
    const amount = n === termMonths ? toMoney(totalDue - sum) : each;
    sum = toMoney(sum + amount);
    installments.push({ n, dueOn: addMonths(issuedOn, n), amount });
  }
  return { principal: p, totalInterest, totalDue, installments };
}

// Principal repaid once `paid` has been paid in total: the same share of principal as of the whole.
// Settled exactly when the loan is, so no cent is ever left on either side.
function principalRepaidBy(paid, { principal, totalDue }) {
  if (!(totalDue > 0)) return 0;
  if (paid >= totalDue - 0.004) return toMoney(principal);
  return toMoney(Math.min(principal, (paid * principal) / totalDue));
}

// One more repayment of `amount` on a loan that has had `paidBefore` repaid so far.
function splitRepayment({ principal, totalDue, paidBefore, amount }) {
  const before = principalRepaidBy(paidBefore, { principal, totalDue });
  const after = principalRepaidBy(toMoney(paidBefore + amount), { principal, totalDue });
  const principalPart = toMoney(after - before);
  return { principalPart, interestPart: toMoney(amount - principalPart) };
}

const dayNumber = (dateString) => {
  const [y, m, d] = dateString.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);

// Where a loan stands today: what is paid, what is left, whether it is behind, and by how much.
// `repayments` is [{ amount }], `today` an EAT date string.
function standing({ principal, interestPercent, termMonths, issuedOn, repayments = [], today }) {
  const schedule = buildSchedule({ principal, interestPercent, termMonths, issuedOn });
  const paid = toMoney(repayments.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
  const outstanding = toMoney(Math.max(0, schedule.totalDue - paid));
  const principalOutstanding = toMoney(schedule.principal - principalRepaidBy(paid, schedule));

  // What should have been paid by now, instalment by instalment, and the first one that has not been.
  let cumulative = 0;
  let dueToDate = 0;
  let firstUnmet = null;
  let nextDue = null;
  const rows = schedule.installments.map((inst) => {
    cumulative = toMoney(cumulative + inst.amount);
    const isDue = inst.dueOn <= today;
    if (isDue) dueToDate = cumulative;
    const covered = paid >= cumulative - 0.004;
    if (isDue && !covered && !firstUnmet) firstUnmet = inst;
    if (!isDue && !covered && !nextDue) nextDue = inst;
    return { ...inst, cumulative, status: covered ? 'paid' : isDue ? 'overdue' : 'upcoming' };
  });

  const overdueAmount = toMoney(Math.max(0, dueToDate - paid));
  return {
    ...schedule,
    installments: rows,
    paid,
    outstanding,
    principalOutstanding,
    interestOutstanding: toMoney(outstanding - principalOutstanding),
    settled: outstanding <= 0.004,
    overdueAmount,
    daysOverdue: overdueAmount > 0 && firstUnmet ? Math.max(0, daysBetween(firstUnmet.dueOn, today)) : 0,
    nextDue: nextDue ? { n: nextDue.n, dueOn: nextDue.dueOn, amount: nextDue.amount } : null,
    finalDueOn: schedule.installments[schedule.installments.length - 1]?.dueOn || null,
  };
}

module.exports = {
  MAX_TERM_MONTHS,
  MAX_RATE,
  addMonths,
  validateTerms,
  buildSchedule,
  principalRepaidBy,
  splitRepayment,
  standing,
};
