// What the fine payment screen tells the office before it presses the button.
//
// The two ways a fine can be paid move different money, and a screen that let the office record the
// wrong one — or take more from a balance than there is — would leave a member's figure wrong by the
// fine. These pin the arithmetic and the sentences it shows.
import test from 'node:test';
import assert from 'node:assert/strict';

import { allocateFines, eatDay, paymentPreview, paymentSummary, sourceLabel } from '../src/utils/finePayment.js';

// Oldest first, the order the server hands them over in and clears them in.
const fines = [
  { id: 'b', remaining: 500, date: '2026-01-10', type: 'Absent', reason: 'Missed the AGM' },
  { id: 'c', remaining: 100, date: '2026-02-05', type: 'Phone', reason: '' },
  { id: 'a', remaining: 300, date: '2026-03-01', type: 'Late arrival', reason: '' },
];

test('paying from his balance clears every fine when he holds enough, each on its own line', () => {
  const rows = allocateFines(fines, { held: 2000, source: 'balance' });
  assert.deepEqual(rows.map((r) => [r.id, r.paying, r.remainingAfter]), [
    ['b', 500, 0],
    ['c', 100, 0],
    ['a', 300, 0],
  ]);
});

test('when his balance runs short the oldest fines are cleared first and the rest stay owed', () => {
  const rows = allocateFines(fines, { held: 650, source: 'balance' });
  assert.deepEqual(rows.map((r) => [r.id, r.paying, r.remainingAfter]), [
    ['b', 500, 0],
    ['c', 100, 0],
    ['a', 50, 250],
  ]);
});

test('paid in cash clears every fine whatever he holds', () => {
  const rows = allocateFines(fines, { held: 0, source: 'cash' });
  assert.deepEqual(rows.map((r) => r.paying), [500, 100, 300]);
});

test('a payment taken from his balance shows what he holds afterwards; cash does not touch it', () => {
  const fromBalance = paymentPreview({ fines, held: 2000, source: 'balance' });
  assert.equal(fromBalance.valid, true);
  assert.equal(fromBalance.total, 900);
  assert.equal(fromBalance.owedAfter, 0);
  assert.equal(fromBalance.heldAfter, 1100);

  const cash = paymentPreview({ fines, held: 2000, source: 'cash' });
  assert.equal(cash.valid, true);
  assert.equal(cash.total, 900);
  assert.equal(cash.heldAfter, null, 'his balance never held cash he paid on the side');
});

test('a balance that does not cover everything pays what it can and says what stays owed', () => {
  const part = paymentPreview({ fines, held: 650, source: 'balance' });
  assert.equal(part.valid, true);
  assert.equal(part.total, 650);
  assert.equal(part.owedAfter, 250);
  assert.equal(part.heldAfter, 0);
});

test('a payment dated before a fine was issued leaves that fine alone, as the server does', () => {
  // 'a' was issued on 1 March; the money changed hands on 15 February.
  const preview = paymentPreview({ fines, held: 5000, source: 'balance', paidOn: '2026-02-15' });
  assert.equal(preview.valid, true);
  assert.deepEqual(preview.rows.map((r) => [r.id, r.paying, r.later]), [
    ['b', 500, false],
    ['c', 100, false],
    ['a', 0, true],
  ]);
  assert.equal(preview.total, 600);
  assert.equal(preview.owedAfter, 300);

  const none = paymentPreview({ fines, held: 5000, source: 'cash', paidOn: '2025-12-31' });
  assert.equal(none.valid, false);
  assert.match(none.problem, /issued after that date/);
});

test('a fine is dated by the day on the group clock, East Africa Time', () => {
  // 22:00 UTC on the 14th is 01:00 on the 15th in Nairobi.
  assert.equal(eatDay('2026-02-14T22:00:00Z'), '2026-02-15');
  assert.equal(eatDay('2026-02-14T20:59:00Z'), '2026-02-14');
  assert.equal(eatDay('nonsense'), '');
});

test('the preview refuses what the server would refuse, in words', () => {
  const nothing = paymentPreview({ fines: [], held: 500, source: 'cash' });
  assert.equal(nothing.valid, false);
  assert.equal(nothing.problem, 'He owes no fines');

  const broke = paymentPreview({ fines, held: 0, source: 'balance' });
  assert.equal(broke.valid, false);
  assert.match(broke.problem, /not holding any money/);

  const unchosen = paymentPreview({ fines, held: 5000, source: null });
  assert.equal(unchosen.valid, false);
  assert.equal(unchosen.problem, 'Choose how it was paid');
  assert.deepEqual(unchosen.rows.map((r) => r.paying), [0, 0, 0], 'nothing is promised before a choice');
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

test('the message for a member email cannot reach reads as a message to him', async () => {
  const { paymentMessage } = await import('../src/utils/finePayment.js');
  assert.equal(
    paymentMessage({
      memberName: 'Jane Wanjiru',
      totalApplied: 400,
      source: 'balance',
      held: { before: 2000, after: 1600 },
      owedAfter: 500,
    }),
    'Hello Jane, We have taken Ksh 400 from your balance with the group to pay your fines. The group now holds Ksh 1,600 for you. You still owe Ksh 500 in fines. Thank you.'
  );
  assert.equal(
    paymentMessage({ memberName: 'Jane Wanjiru', totalApplied: 900, source: 'cash', held: null, owedAfter: 0 }),
    'Hello Jane, We have received your fine payment of Ksh 900. You owe no more fines. Thank you.'
  );
});
