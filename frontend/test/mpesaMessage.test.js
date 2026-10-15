// Reading the amount and code off a pasted M-Pesa message.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMpesaMessage } from '../src/utils/mpesaMessage.js';

test('a sent-money message gives its code and the amount sent, not the balance', () => {
  const read = parseMpesaMessage(
    'SK9X2Q1LMN Confirmed. Ksh1,400.00 sent to WAZO MOJA on 17/9/26 at 10:42 AM. New M-PESA balance is Ksh3,200.00. Transaction cost, Ksh0.00.'
  );
  assert.deepEqual(read, { code: 'SK9X2Q1LMN', amount: 1400 });
});

test('a received-money message reads the same way', () => {
  const read = parseMpesaMessage('QJK7YU90AB Confirmed.You have received Ksh2,500.50 from JANE WANJIRU 0712345678.');
  assert.deepEqual(read, { code: 'QJK7YU90AB', amount: 2500.5 });
});

test('"Ksh 400" with a space and "KES" style text are handled or ignored, never guessed', () => {
  assert.equal(parseMpesaMessage('paid Ksh 400 cash').amount, 400);
  assert.equal(parseMpesaMessage('paid 400 shillings').amount, null);
});

test('a note that is not a message gives nothing', () => {
  assert.deepEqual(parseMpesaMessage('Handed over at the meeting'), { code: null, amount: null });
  assert.deepEqual(parseMpesaMessage(''), { code: null, amount: null });
  assert.deepEqual(parseMpesaMessage(undefined), { code: null, amount: null });
});
