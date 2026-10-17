// Member loans against a real database. The point of the suite is that the group's EXISTING figures
// stay right through every step: a loan takes money out of a fund as "owed back" (not spent), each
// repayment gives principal back and records only the interest as income, and taking a repayment back
// or cancelling a loan puts every figure exactly where it was.
//
//   npm run test:integration
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-to-pass';
process.env.FINE_EMAILS = 'off';

const URI = process.env.TEST_MONGO_URI || '';
const skip = URI
  ? false
  : 'needs a scratch MongoDB — run npm run test:integration (see the note at the top of this file)';
const targetFor = (name) => URI.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);
if (URI && !/rehearsal|scratch|test/i.test(URI)) {
  throw new Error(`TEST_MONGO_URI (${URI}) does not look like a scratch database — refusing to run.`);
}

const app = require('../../src/app');
const Member = require('../../src/models/Member');
const User = require('../../src/models/User');
const Loan = require('../../src/models/Loan');
const Expense = require('../../src/models/Expense');
const Contribution = require('../../src/models/Contribution');
const ContributionType = require('../../src/models/ContributionType');
const AuditLog = require('../../src/models/AuditLog');
const Settings = require('../../src/models/Settings');
const { invalidateSettings } = require('../../src/utils/settings');
const { seedLedgerTypes, seedGroupFunds } = require('../../src/utils/ledgerTypes');
const { computeMoneyPosition } = require('../../src/utils/moneyPosition');
const { toEatDateString } = require('../../src/utils/weekCycle');

let server;
let base;
let tokens = {};
let fund;
let borrower;
let other;
let superId;

const sign = (id, role) => jwt.sign({ id, role, scope: 'session' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const call = async (method, route, { body, token = tokens.treasurer } = {}) => {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const daysAgo = (n) => toEatDateString(new Date(Date.now() - n * 86400000));
const r2 = (n) => Math.round(n * 100) / 100;

// The figures the group already reads, in one place.
async function books() {
  const p = await computeMoneyPosition();
  const f = p.funds.find((x) => String(x.typeId) === String(fund._id));
  return {
    netBalance: r2(p.netBalance),
    totalContributed: r2(p.totalContributed),
    totalExpenses: r2(p.totalExpenses),
    fundBalance: r2(f.balance),
    onLoan: r2(p.groupFund.onLoan),
    spent: r2(p.groupFund.spent),
  };
}

test.before(async () => {
  if (skip) return;
  await mongoose.connect(targetFor('chama-rehearsal-loans'), { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  invalidateSettings();
  await seedLedgerTypes();
  await seedGroupFunds();

  const hash = await bcrypt.hash('rehearsal-password1', 10);
  const make = (name, role) => User.create({ name, email: `${role}@example.com`, password: hash, role });
  const sup = await make('Super', 'super_admin');
  superId = sup._id;
  tokens = {
    super: sign(sup._id, 'super_admin'),
    admin: sign((await make('Admin', 'admin'))._id, 'admin'),
    treasurer: sign((await make('Treasurer', 'treasurer'))._id, 'treasurer'),
    secretary: sign((await make('Secretary', 'secretary'))._id, 'secretary'),
  };
  borrower = await Member.create({ name: 'Bella Borrower', phone: '0712000301', regNumber: 'B/1', nationalId: '41000001' });
  other = await Member.create({ name: 'Otto Other', phone: '0712000302', regNumber: 'B/2', nationalId: '41000002' });

  fund = await ContributionType.findOne({ name: 'Member Refunds & Loans Fund' });
  await Contribution.create({ memberId: other._id, typeId: fund._id, amount: 50000, method: 'cash', loggedBy: superId });

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const terms = (extra = {}) => ({ memberId: String(borrower._id), fundId: String(fund._id), principal: 10000, interestPercent: 10, termMonths: 4, date: daysAgo(1), ...extra });

test('only the roles that keep the money can reach loans', { skip }, async () => {
  assert.equal((await call('GET', '/api/loans', { token: tokens.secretary })).status, 403);
  assert.equal((await call('GET', '/api/loans', { token: null })).status, 401);
  assert.equal((await call('GET', '/api/loans')).status, 200);
});

test('a fund must be made a loan fund first, confirmed with the figure in front of the person confirming', { skip }, async () => {
  const early = await call('POST', '/api/loans', { body: terms() });
  assert.equal(early.status, 400);
  assert.equal(early.body.code, 'NOT_LOAN_FUND');

  // Something already paid out of it: marking it would change how that money is counted.
  await Expense.create({ source: 'fund', typeId: fund._id, amount: 1000, date: new Date(), description: 'Earlier refund', loggedBy: superId });
  const before = await books();

  // The treasurer cannot decide how the books read.
  assert.equal((await call('POST', `/api/loans/funds/${fund._id}/mark-loan-fund`, { body: { confirm: true } })).status, 403);
  const warn = await call('POST', `/api/loans/funds/${fund._id}/mark-loan-fund`, { token: tokens.admin, body: {} });
  assert.equal(warn.status, 409);
  assert.equal(warn.body.code, 'NEEDS_CONFIRM');
  assert.equal(warn.body.spent, 1000);
  assert.match(warn.body.message, /counted as owed back instead of spent/);
  assert.equal((await ContributionType.findById(fund._id)).isRecoverable, false, 'nothing changed without the confirmation');

  const done = await call('POST', `/api/loans/funds/${fund._id}/mark-loan-fund`, { token: tokens.admin, body: { confirm: true } });
  assert.equal(done.status, 200);
  const after = await books();
  assert.equal(after.netBalance, r2(before.netBalance + 1000), 'what was paid out is now owed back, which is what the warning said');
  assert.ok(await AuditLog.findOne({ entityType: 'ContributionType', entityId: fund._id }));

  // Put it back the way the rest of the suite expects.
  await Expense.deleteMany({ description: 'Earlier refund' });
  const funds = await call('GET', '/api/loans/funds');
  assert.equal(funds.body.funds.find((f) => f.id === String(fund._id)).isRecoverable, true);
});

test('lending takes money out of the fund as owed back, not spent, and moves no other figure', { skip }, async () => {
  const start = await books();
  const res = await call('POST', '/api/loans', { body: terms({ note: 'School fees' }) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const loan = res.body.loan;
  assert.equal(loan.loanNumber, 'LN-0001');
  assert.equal(loan.totalInterest, 1000);
  assert.equal(loan.totalDue, 11000);
  assert.equal(loan.outstanding, 11000);
  assert.equal(loan.installments.length, 4);

  const now = await books();
  assert.equal(now.fundBalance, r2(start.fundBalance - 10000), 'the fund is lighter by what was lent');
  assert.equal(now.onLoan, r2(start.onLoan + 10000), 'and it is counted as out on loan');
  assert.equal(now.netBalance, start.netBalance, 'the group still owns it: what the group holds does not move');
  assert.equal(now.totalExpenses, start.totalExpenses, 'it is not spending');
  assert.equal(now.spent, start.spent);

  // It is on the expense list as the loan's, and the loan's alone to change.
  const ex = await Expense.findOne({ loanId: loan.id });
  assert.equal(ex.amount, 10000);
  assert.equal(ex.reference, 'LN-0001');
  assert.equal((await call('PATCH', `/api/expenses/${ex._id}`, { body: { amount: 1 } })).body.code, 'LOAN_EXPENSE');
  assert.equal((await call('DELETE', `/api/expenses/${ex._id}`)).body.code, 'LOAN_EXPENSE');
  assert.ok(await AuditLog.findOne({ entityType: 'Loan', entityId: loan.id, action: 'create' }));
});

test('each repayment gives principal back and records only the interest as income', { skip }, async () => {
  const loan = await Loan.findOne({ loanNumber: 'LN-0001' });
  const start = await books();

  const res = await call('POST', `/api/loans/${loan._id}/repayments`, { body: { amount: 2750, date: daysAgo(0), method: 'mobile', clientRequestId: 'pay-1' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.split, { principalPart: 2500, interestPart: 250 });
  assert.equal(res.body.loan.outstanding, 8250);
  assert.equal(res.body.loan.principalOutstanding, 7500);

  const now = await books();
  assert.equal(now.onLoan, r2(start.onLoan - 2500), 'principal is no longer out on loan');
  assert.equal(now.fundBalance, r2(start.fundBalance + 2500 + 250), 'the fund has the principal back, and the interest');
  assert.equal(now.totalContributed, r2(start.totalContributed + 250), 'only the interest is income');
  assert.equal(now.netBalance, r2(start.netBalance + 250), 'so the group holds exactly the interest more, not the principal twice');
  assert.equal(now.totalExpenses, start.totalExpenses);
  const interest = await Contribution.findOne({ note: 'Loan LN-0001 interest' });
  assert.equal(interest.amount, 250);
  assert.equal(String(interest.memberId), String(borrower._id));

  // The same submit sent again is the same payment.
  const again = await call('POST', `/api/loans/${loan._id}/repayments`, { body: { amount: 2750, date: daysAgo(0), clientRequestId: 'pay-1' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.replay, true);
  assert.deepEqual(await books(), now, 'a replay moved nothing');

  // More than is owed, and nonsense, are refused with the figure.
  const over = await call('POST', `/api/loans/${loan._id}/repayments`, { body: { amount: 9000, date: daysAgo(0) } });
  assert.equal(over.status, 400);
  assert.match(over.body.message, /8,250 left to repay/);
  assert.equal((await call('POST', `/api/loans/${loan._id}/repayments`, { body: { amount: 0 } })).status, 400);
  assert.equal((await call('POST', `/api/loans/${loan._id}/repayments`, { body: { amount: 100, date: daysAgo(-3) } })).status, 400);
  assert.equal((await call('POST', `/api/loans/${loan._id}/repayments`, { body: { amount: 100, date: daysAgo(30) } })).status, 400, 'not before the loan was made');
});

test('paying it off clears the loan and leaves the books richer by exactly the interest', { skip }, async () => {
  const loan = await Loan.findOne({ loanNumber: 'LN-0001' });
  const baseline = await books();
  const res = await call('POST', `/api/loans/${loan._id}/repayments`, { body: { amount: 8250, date: daysAgo(0) } });
  assert.equal(res.status, 201);
  assert.equal(res.body.loan.status, 'cleared');
  assert.equal(res.body.loan.outstanding, 0);
  assert.equal((await Expense.findOne({ loanId: loan._id })).deleted, true, 'nothing is out on loan any more');
  const done = await books();
  assert.equal(done.onLoan, r2(baseline.onLoan - 7500));
  assert.equal(done.netBalance, r2(baseline.netBalance + 750));
  assert.equal((await call('POST', `/api/loans/${loan._id}/repayments`, { body: { amount: 1 } })).status, 409, 'a paid-off loan takes no more');
  assert.equal(await Contribution.countDocuments({ memberId: borrower._id, note: /Loan LN-0001 interest/, deleted: false }), 2);
  assert.equal(r2((await Contribution.find({ note: /Loan LN-0001 interest/, deleted: false })).reduce((s, c) => s + c.amount, 0)), 1000, 'the interest charged, exactly');
});

test('taking the last repayment back puts every figure where it was', { skip }, async () => {
  const loan = await Loan.findOne({ loanNumber: 'LN-0001' });
  const cleared = await books();
  const res = await call('DELETE', `/api/loans/${loan._id}/repayments/last`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.loan.status, 'active');
  assert.equal(res.body.loan.outstanding, 8250);
  assert.equal((await Expense.findOne({ loanId: loan._id })).deleted, false);
  assert.equal((await Expense.findOne({ loanId: loan._id })).amount, 7500);
  const back = await books();
  assert.equal(back.onLoan, r2(cleared.onLoan + 7500));
  assert.equal(back.netBalance, r2(cleared.netBalance - 750), 'the interest it recorded is gone again');
  assert.equal(await Contribution.countDocuments({ note: /Loan LN-0001 interest/, deleted: false }), 1);

  // Again, back to the start: then nothing is left to take back.
  assert.equal((await call('DELETE', `/api/loans/${loan._id}/repayments/last`)).status, 200);
  assert.equal((await call('DELETE', `/api/loans/${loan._id}/repayments/last`)).status, 400);
  assert.equal((await Expense.findOne({ loanId: loan._id })).amount, 10000);
});

test('a loan made in error is cancelled, and the books forget it ever happened', { skip }, async () => {
  const loan = await Loan.findOne({ loanNumber: 'LN-0001' });
  const lent = await books();
  assert.equal((await call('POST', `/api/loans/${loan._id}/cancel`, { body: {} })).status, 400, 'a reason is required');

  // Not with a repayment on it.
  await call('POST', `/api/loans/${loan._id}/repayments`, { body: { amount: 1000, date: daysAgo(0) } });
  assert.equal((await call('POST', `/api/loans/${loan._id}/cancel`, { body: { reason: 'Wrong member' } })).status, 409);
  await call('DELETE', `/api/loans/${loan._id}/repayments/last`);

  const res = await call('POST', `/api/loans/${loan._id}/cancel`, { body: { reason: 'Wrong member' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.loan.status, 'cancelled');
  const gone = await books();
  assert.equal(gone.onLoan, r2(lent.onLoan - 10000));
  assert.equal(gone.fundBalance, r2(lent.fundBalance + 10000));
  assert.equal(gone.netBalance, lent.netBalance);
  assert.equal((await call('GET', '/api/loans')).body.loans.length, 0, 'cancelled loans are off the live list');
  assert.equal((await call('GET', '/api/loans?status=cancelled')).body.loans.length, 1);
});

test('a loan with no interest, and the limits on what can be lent', { skip }, async () => {
  const free = await call('POST', '/api/loans', { body: terms({ interestPercent: 0, principal: 3000, termMonths: 3 }) });
  assert.equal(free.status, 201);
  assert.equal(free.body.loan.totalInterest, 0);
  const before = await Contribution.countDocuments();
  const pay = await call('POST', `/api/loans/${free.body.loan.id}/repayments`, { body: { amount: 1000, date: daysAgo(0) } });
  assert.deepEqual(pay.body.split, { principalPart: 1000, interestPart: 0 });
  assert.equal(await Contribution.countDocuments(), before, 'no interest, so no income row');

  // More than the fund holds needs the tick, like any other spending.
  const big = await call('POST', '/api/loans', { body: terms({ principal: 5_000_000 }) });
  assert.equal(big.status, 409);
  assert.equal(big.body.code, 'OVERDRAW');
  // Bad terms are said in words.
  assert.match((await call('POST', '/api/loans', { body: terms({ termMonths: 0 }) })).body.message, /months/);
  assert.match((await call('POST', '/api/loans', { body: terms({ interestPercent: 150 }) })).body.message, /percentage/);
  assert.match((await call('POST', '/api/loans', { body: terms({ principal: -5 }) })).body.message, /greater than zero/);
  assert.equal((await call('POST', '/api/loans', { body: terms({ date: daysAgo(-5) }) })).status, 400);
  assert.equal((await call('POST', '/api/loans', { body: terms({ memberId: 'nope' }) })).status, 400);

  // The spending limit applies to lending too.
  await Settings.updateOne({ key: 'main' }, { $set: { expenseApprovalLimit: 2000 } });
  invalidateSettings();
  try {
    const refused = await call('POST', '/api/loans', { body: terms({ principal: 2500 }) });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.needsApproval, true);
    const ok = await call('POST', '/api/loans', { body: terms({ principal: 2500, approvalRef: 'Minutes of 12 Oct, item 6' }) });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.loan.approvalRef, 'Minutes of 12 Oct, item 6');
    await call('POST', `/api/loans/${ok.body.loan.id}/cancel`, { body: { reason: 'Test only' } });
  } finally {
    await Settings.updateOne({ key: 'main' }, { $set: { expenseApprovalLimit: 0 } });
    invalidateSettings();
  }
});

test('a loan that is behind is counted, shown in the Control Room, and stops a resignation', { skip }, async () => {
  // Lent a hundred days ago for a month, nothing repaid.
  const late = await call('POST', '/api/loans', { body: terms({ date: daysAgo(100), principal: 4000, interestPercent: 5, termMonths: 1 }) });
  assert.equal(late.status, 201, JSON.stringify(late.body));
  assert.ok(late.body.loan.overdueAmount > 0);
  assert.ok(late.body.loan.daysOverdue >= 60);

  const list = await call('GET', '/api/loans');
  assert.ok(list.body.summary.overdueLoans >= 1);
  assert.ok(list.body.summary.overdueAmount >= 4200);
  assert.ok(list.body.summary.interestEarned >= 0);

  const overview = await call('GET', '/api/superadmin/overview', { token: tokens.super });
  const item = overview.body.attention.find((a) => a.id === 'loans-overdue');
  assert.ok(item, 'the Control Room says a loan is behind');
  assert.equal(item.link, '/admin/loans');

  // He cannot be resigned without saying what became of the loan.
  const resign = await call('POST', `/api/members/${borrower._id}/resign`, { body: { reason: 'Moving' } });
  assert.equal(resign.status, 409);
  assert.equal(resign.body.needsSettlement, true);
  // This loan (4,200) and the interest-free one from the test before (2,000 still to repay): all he owes.
  assert.equal(resign.body.loanOwed, 6200);
  assert.match(resign.body.message, /on a loan/);
});

test('a repayment dated in closed books is held by the lock, and the super admin goes through with a reason', { skip }, async () => {
  const loan = await Loan.findOne({ status: 'active', principal: 4000 });
  await Settings.updateOne({ key: 'main' }, { $set: { lockedThrough: new Date(Date.now() - 5 * 86400000), lockReason: 'Agreed' } });
  invalidateSettings();
  try {
    const blocked = await call('POST', `/api/loans/${loan._id}/repayments`, { body: { amount: 100, date: daysAgo(10) } });
    assert.equal(blocked.status, 423);
    assert.equal(blocked.body.code, 'period_locked');
    assert.equal((await call('POST', '/api/loans', { body: terms({ date: daysAgo(10) }) })).status, 423);
    // Dated after the lock is fine.
    assert.equal((await call('POST', `/api/loans/${loan._id}/repayments`, { body: { amount: 100, date: daysAgo(1) } })).status, 201);
    // Taking back a payment made in the closed period is held too.
    await Loan.updateOne({ _id: loan._id }, { $set: { 'repayments.0.date': new Date(Date.now() - 10 * 86400000) } });
    assert.equal((await call('DELETE', `/api/loans/${loan._id}/repayments/last`)).status, 423);
  } finally {
    await Settings.updateOne({ key: 'main' }, { $set: { lockedThrough: null, lockReason: '' } });
    invalidateSettings();
  }
});
