// What the audit trail says about a fine being paid.
//
// A fine payment used to read as "amount left" changing, which says nothing about whether the
// member's own money moved. The entries now carry how the payment was made, and these pin that the
// trail says it in words and flags the one kind that changes what the group holds for a member.
//
// Pure: no database, no clock.
const test = require('node:test');
const assert = require('node:assert/strict');

const { readAuditEntry } = require('../src/utils/auditFlags');

const keys = (read) => read.flags.map((f) => f.key);

const fine = (over = {}) => ({
  amount: 500,
  remaining: 500,
  reason: 'Late',
  memberId: '65a0000000000000000000m1',
  typeId: '65a0000000000000000000t1',
  deleted: false,
  ...over,
});

const entry = (before, after, action = 'update') => ({ action, entityType: 'Fine', before, after });

test('a fine taken from a balance is said in words and flagged', () => {
  const read = readAuditEntry(
    entry(fine(), fine({ remaining: 200, paidFromBalance: { amount: 300, heldBefore: 5000, heldAfter: 4700 } }))
  );
  assert.equal(read.summary, 'Ksh 300 paid from his balance (Ksh 5,000 → Ksh 4,700)');
  assert.deepEqual(keys(read), ['fine-from-balance']);
  assert.equal(read.severity, 'watch');
});

test('a fine paid in cash is said in words and is not flagged', () => {
  const read = readAuditEntry(entry(fine(), fine({ remaining: 0, paidInCash: { amount: 500 } })));
  assert.equal(read.summary, 'Ksh 500 paid in cash');
  assert.deepEqual(keys(read), []);
  assert.equal(read.severity, null);
});

test('a payment taken back says whether the money went back to a balance', () => {
  const fromBalance = readAuditEntry(
    entry(fine({ remaining: 200 }), fine({ remaining: 500, paymentUndone: { amount: 300, source: 'balance' } }))
  );
  assert.equal(fromBalance.summary, 'Ksh 300 payment taken back, returned to his balance');
  assert.deepEqual(keys(fromBalance), ['payment-undone']);

  const cash = readAuditEntry(
    entry(fine({ remaining: 400 }), fine({ remaining: 500, paymentUndone: { amount: 100, source: 'cash' } }))
  );
  assert.equal(cash.summary, 'Ksh 100 payment taken back');
});

test('sorting out an earlier payment is said, and only a balance one is flagged', () => {
  const balance = readAuditEntry(entry(fine(), fine({ paymentChecked: { index: 0, amount: 400, source: 'balance' } })));
  assert.equal(balance.summary, 'Ksh 400 earlier payment marked as taken from his balance');
  assert.deepEqual(keys(balance), ['fine-from-balance']);

  const cash = readAuditEntry(entry(fine(), fine({ paymentChecked: { index: 0, amount: 400, source: 'cash' } })));
  assert.equal(cash.summary, 'Ksh 400 earlier payment marked as paid in cash');
  assert.deepEqual(keys(cash), []);
});

test('voiding a fine that was paid from a balance says the money went back', () => {
  const read = readAuditEntry(entry(fine(), fine({ deleted: true, returnedToBalance: 250 }), 'delete'));
  assert.equal(read.summary, 'Ksh 500 fine voided, Ksh 250 returned to his balance');
  assert.ok(keys(read).includes('money-removed'));
  assert.ok(keys(read).includes('returned-to-balance'));
});

test('an ordinary fine entry reads as it always did', () => {
  const created = readAuditEntry(entry(null, fine(), 'create'));
  assert.equal(created.summary, 'Ksh 500');
  assert.deepEqual(keys(created), []);
});
