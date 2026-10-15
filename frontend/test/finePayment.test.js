// What the fine payment screen tells the office before it presses the button.
//
// The two ways a fine can be paid move different money, and a screen that let the office record the
// wrong one — or take more from a balance than there is — would leave a member's figure wrong by the
// fine. These pin the arithmetic and the sentences it shows.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAmount,
  owedFor,
  balanceChoice,
  paymentPreview,
  paymentSummary,
  sourceLabel,
} from '../src/utils/finePayment.js';

const fines = [
  { id: 'a', remaining: 300, date: '2026-03-01', type: 'Late arrival', reason: '' },
  { id: 'b', remaining: 500, date: '2026-01-10', type: 'Absent', reason: 'Missed the AGM' },
  { id: 'c', remaining: 100, date: '2026-02-05', type: 'Phone', reason: '' },
];

test('an amount typed with commas or spaces reads the same, and nothing at all is not zero', () => {
  assert.equal(parseAmount('1,500'), 1500);
  assert.equal(parseAmount(' 1 500 '), 1500);
  assert.equal(parseAmount('250.50'), 250.5);
  assert.ok(Number.isNaN(parseAmount('')));
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.equal(parseAmount('0'), 0);
});

test('what can be paid is what is owed on the chosen fine, and nothing without one', () => {
  assert.equal(owedFor(fines, 'b'), 500);
  assert.equal(owedFor(fines, 'a'), 300);
  assert.equal(owedFor(fines, 'missing'), 0);
  assert.equal(owedFor(fines, null), 0, 'a payment is never spread over every fine');
});

test('the balance can pay only what the group holds for him', () => {
  assert.equal(balanceChoice({ held: 1000, amount: 400 }).allowed, true);
  assert.equal(balanceChoice({ held: 400, amount: 400 }).allowed, true);

  const short = balanceChoice({ held: 300, amount: 400 });
  assert.equal(short.allowed, false);
  assert.match(short.reason, /He holds only Ksh 300/);
  assert.match(short.reason, /paid in cash/);

  const none = balanceChoice({ held: 0, amount: 100 });
  assert.equal(none.allowed, false);
  assert.match(none.reason, /not holding any money/);
});

test('a payment taken from his balance shows what he holds afterwards; cash does not touch it', () => {
  const fromBalance = paymentPreview({ owed: 900, held: 2000, amount: 400, source: 'balance' });
  assert.equal(fromBalance.valid, true);
  assert.equal(fromBalance.owedAfter, 500);
  assert.equal(fromBalance.heldAfter, 1600);

  const cash = paymentPreview({ owed: 900, held: 2000, amount: 400, source: 'cash' });
  assert.equal(cash.valid, true);
  assert.equal(cash.owedAfter, 500);
  assert.equal(cash.heldAfter, null, 'his balance never held cash he paid on the side');
});

test('the preview refuses what the server would refuse, in words', () => {
  assert.equal(paymentPreview({ owed: 900, held: 100, amount: NaN, source: 'cash' }).valid, false);
  assert.equal(paymentPreview({ owed: 900, held: 100, amount: 0, source: 'cash' }).valid, false);

  const over = paymentPreview({ owed: 900, held: 5000, amount: 1000, source: 'cash' });
  assert.equal(over.valid, false);
  assert.match(over.problem, /more than the Ksh 900 owed/);

  const poor = paymentPreview({ owed: 900, held: 200, amount: 400, source: 'balance' });
  assert.equal(poor.valid, false);
  assert.match(poor.problem, /He holds only Ksh 200/);

  const unchosen = paymentPreview({ owed: 900, held: 5000, amount: 400, source: null });
  assert.equal(unchosen.valid, false);
  assert.equal(unchosen.problem, 'Choose how it was paid');
});

test('a payment is summarised in the words the office reads out', () => {
  assert.equal(
    paymentSummary({
      memberName: 'Jane Wanjiru',
      totalApplied: 400,
      source: 'balance',
      held: { before: 2000, after: 1600 },
      owedAfter: 500,
    }),
    'Ksh 400 was taken from Jane Wanjiru’s balance. The group now holds Ksh 1,600 for him. He still owes Ksh 500 in fines.'
  );
  assert.equal(
    paymentSummary({ memberName: 'Jane Wanjiru', totalApplied: 900, source: 'cash', held: null, owedAfter: 0 }),
    'Ksh 900 paid by Jane Wanjiru was recorded. He owes no more fines.'
  );
});

test('every way a payment can have been made has a name', () => {
  assert.equal(sourceLabel('balance'), 'Taken from his balance');
  assert.equal(sourceLabel('cash'), 'Paid in cash / M-Pesa');
  assert.equal(sourceLabel('contribution'), 'Out of a contribution');
  assert.match(sourceLabel(null), /not yet checked/);
});
