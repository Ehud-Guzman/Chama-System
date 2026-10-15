// The M-Pesa code on a pasted confirmation message.
const test = require('node:test');
const assert = require('node:assert/strict');

const { extractMpesaCodes } = require('../src/utils/mpesaCode');

test('the code is read out of a real confirmation message', () => {
  const message =
    'SK9X2Q1LMN Confirmed. Ksh1,400.00 sent to WAZO MOJA on 17/9/26 at 10:42 AM. New M-PESA balance is Ksh3,200.00.';
  assert.deepEqual(extractMpesaCodes(message), ['SK9X2Q1LMN']);
});

test('a received-money message works the same way', () => {
  assert.deepEqual(
    extractMpesaCodes('QJK7YU90AB Confirmed.You have received Ksh1,400.00 from JANE WANJIRU 0712345678.'),
    ['QJK7YU90AB']
  );
});

test('ordinary words, short strings and notes with no code give nothing', () => {
  assert.deepEqual(extractMpesaCodes('Cash handed over at the meeting'), []);
  assert.deepEqual(extractMpesaCodes('CONFIRMEDOK'), [], 'ten upper-case letters with no digit is a word');
  assert.deepEqual(extractMpesaCodes('SK9X2Q1'), [], 'too short');
  assert.deepEqual(extractMpesaCodes('sk9x2q1lmn'), [], 'a code is upper case');
  assert.deepEqual(extractMpesaCodes(''), []);
  assert.deepEqual(extractMpesaCodes(null), []);
});

test('the same code twice in one message is one code, and two codes are both found', () => {
  assert.deepEqual(extractMpesaCodes('SK9X2Q1LMN and again SK9X2Q1LMN'), ['SK9X2Q1LMN']);
  assert.deepEqual(extractMpesaCodes('SK9X2Q1LMN then QJK7YU90AB'), ['SK9X2Q1LMN', 'QJK7YU90AB']);
});

test('a longer run of letters and digits is not mistaken for a code', () => {
  assert.deepEqual(extractMpesaCodes('SK9X2Q1LMNPQ'), []);
});
