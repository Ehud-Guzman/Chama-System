// The arithmetic behind a member loan. The books count what a loan took out of a fund as owed back
// and count interest as income, so the split of every repayment between the two has to be exact:
// these checks are about the cents.
const test = require('node:test');
const assert = require('node:assert/strict');
const { addMonths, validateTerms, buildSchedule, splitRepayment, standing, principalRepaidBy } = require('../src/utils/loanMath');

const TERMS = { principal: 10000, interestPercent: 10, termMonths: 4, issuedOn: '2026-01-31' };
const cents = (n) => Math.round(n * 100);

test('interest is flat, once, on the amount lent', () => {
  const s = buildSchedule(TERMS);
  assert.equal(s.totalInterest, 1000);
  assert.equal(s.totalDue, 11000);
  assert.equal(s.installments.length, 4);
  assert.deepEqual(s.installments.map((i) => i.amount), [2750, 2750, 2750, 2750]);
  // No interest is allowed: the total due is simply the principal.
  assert.equal(buildSchedule({ ...TERMS, interestPercent: 0 }).totalDue, 10000);
});

test('instalments that do not divide evenly add up to exactly what is due', () => {
  const s = buildSchedule({ principal: 10000, interestPercent: 10, termMonths: 3, issuedOn: '2026-01-10' });
  assert.equal(cents(s.installments.reduce((sum, i) => sum + i.amount, 0)), 1100000);
  // The last one takes the odd cent, not the first.
  assert.equal(s.installments[0].amount, 3666.67);
  assert.equal(s.installments[2].amount, 3666.66);
});

test('a month with fewer days takes the last day, not the start of the next month', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.deepEqual(buildSchedule(TERMS).installments.map((i) => i.dueOn), ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
});

test('the terms are checked in words a treasurer can act on', () => {
  assert.equal(validateTerms(TERMS), null);
  assert.match(validateTerms({ ...TERMS, principal: 0 }), /greater than zero/);
  assert.match(validateTerms({ ...TERMS, principal: 'abc' }), /greater than zero/);
  assert.match(validateTerms({ ...TERMS, interestPercent: -1 }), /percentage/);
  assert.match(validateTerms({ ...TERMS, interestPercent: 101 }), /percentage/);
  assert.match(validateTerms({ ...TERMS, termMonths: 0 }), /months/);
  assert.match(validateTerms({ ...TERMS, termMonths: 2.5 }), /months/);
  assert.match(validateTerms({ ...TERMS, termMonths: 61 }), /months/);
});

test('every repayment is split in the proportion the loan was priced in', () => {
  const t = { principal: 10000, totalDue: 11000 };
  // 2,750 of 11,000 is a quarter: a quarter of the principal, a quarter of the interest.
  assert.deepEqual(splitRepayment({ ...t, paidBefore: 0, amount: 2750 }), { principalPart: 2500, interestPart: 250 });
  assert.deepEqual(splitRepayment({ ...t, paidBefore: 2750, amount: 2750 }), { principalPart: 2500, interestPart: 250 });
});

test('however a borrower pays, principal and interest add up to exactly what was lent and charged', () => {
  const t = { principal: 10000, totalDue: 11000 };
  // Odd amounts, in awkward orders, each ending on the exact balance.
  for (const pattern of [[333.33, 4000, 1.01, 5000, 1665.66], [11000], [1, 1, 1, 10997], [5500.5, 5499.5]]) {
    let paid = 0;
    let principal = 0;
    let interest = 0;
    for (const amount of pattern) {
      const part = splitRepayment({ ...t, paidBefore: paid, amount });
      assert.equal(cents(part.principalPart + part.interestPart), cents(amount), 'a repayment is exactly its two parts');
      principal = (cents(principal) + cents(part.principalPart)) / 100;
      interest = (cents(interest) + cents(part.interestPart)) / 100;
      paid = (cents(paid) + cents(amount)) / 100;
    }
    assert.equal(paid, 11000, JSON.stringify(pattern));
    assert.equal(principal, 10000, `principal for ${JSON.stringify(pattern)}`);
    assert.equal(interest, 1000, `interest for ${JSON.stringify(pattern)}`);
  }
  assert.equal(principalRepaidBy(11000, t), 10000);
  assert.equal(principalRepaidBy(0, t), 0);
});

test('a loan is on time until an instalment has fallen due and is not covered', () => {
  const base = { ...TERMS, repayments: [] };
  // Before the first due date: nothing owed yet.
  let s = standing({ ...base, today: '2026-02-27' });
  assert.equal(s.overdueAmount, 0);
  assert.equal(s.daysOverdue, 0);
  assert.equal(s.nextDue.dueOn, '2026-02-28');
  assert.equal(s.outstanding, 11000);
  assert.equal(s.principalOutstanding, 10000);

  // The day it falls due, unpaid: behind by one instalment, from that day.
  s = standing({ ...base, today: '2026-02-28' });
  assert.equal(s.overdueAmount, 2750);
  assert.equal(s.daysOverdue, 0);
  s = standing({ ...base, today: '2026-03-10' });
  assert.equal(s.overdueAmount, 2750);
  assert.equal(s.daysOverdue, 10);

  // Two fell due, one paid: behind by one, counted from the unmet one.
  s = standing({ ...base, repayments: [{ amount: 2750 }], today: '2026-04-05' });
  assert.equal(s.overdueAmount, 2750);
  assert.equal(s.daysOverdue, 5);
  assert.equal(s.installments.map((i) => i.status).join(), 'paid,overdue,upcoming,upcoming');

  // Paying ahead covers later instalments; paying the lot settles it.
  s = standing({ ...base, repayments: [{ amount: 8250 }], today: '2026-03-31' });
  assert.equal(s.overdueAmount, 0);
  assert.equal(s.nextDue.n, 4);
  s = standing({ ...base, repayments: [{ amount: 5000 }, { amount: 6000 }], today: '2026-06-30' });
  assert.equal(s.settled, true);
  assert.equal(s.outstanding, 0);
  assert.equal(s.principalOutstanding, 0);
  assert.equal(s.overdueAmount, 0);
});

test('what is left to repay splits into principal and interest and adds up', () => {
  const s = standing({ ...TERMS, repayments: [{ amount: 2750 }], today: '2026-02-01' });
  assert.equal(s.paid, 2750);
  assert.equal(s.principalOutstanding, 7500);
  assert.equal(s.interestOutstanding, 750);
  assert.equal(cents(s.principalOutstanding + s.interestOutstanding), cents(s.outstanding));
});
