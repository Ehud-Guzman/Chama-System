// Money arithmetic.
//
// Amounts are Kenyan shillings held as JavaScript numbers, so the thing worth
// pinning down is that every value that reaches the database has been rounded to
// two decimal places and that nothing absurd gets through.
const test = require('node:test');
const assert = require('node:assert/strict');

const { toMoney, readMoney, moneySetter, MAX_AMOUNT } = require('../src/utils/money');

test('toMoney rounds to two decimal places', () => {
  assert.equal(toMoney(0.1 + 0.2), 0.3); // the classic
  assert.equal(toMoney('1400'), 1400);
  assert.equal(toMoney(1400.567), 1400.57);
  assert.equal(toMoney(0.005), 0.01);
  assert.equal(toMoney(-0), 0);
});

test('toMoney refuses to invent an amount from nonsense', () => {
  assert.equal(toMoney(undefined), 0);
  assert.equal(toMoney(null), 0);
  assert.equal(toMoney('not a number'), 0);
  assert.equal(toMoney(NaN), 0);
  assert.equal(toMoney(Infinity), 0);
});

test('summing rounded amounts stays exact over a year of weeks', () => {
  // 92 weeks of 1,400 plus 92 weeks of 100 of tea, added one at a time the way the
  // ledger adds them.
  let total = 0;
  for (let week = 0; week < 92; week += 1) total += toMoney(1400) + toMoney(100);
  assert.equal(total, 92 * 1500);
  assert.equal(toMoney(total), 138000);
});

test('readMoney accepts a usable figure and reports why it refused one', () => {
  assert.deepEqual(readMoney('1400'), { value: 1400 });
  assert.deepEqual(readMoney(50.5), { value: 50.5 });
  assert.equal(readMoney('').error, 'Amount is required');
  assert.equal(readMoney(undefined).error, 'Amount is required');
  assert.equal(readMoney('abc').error, 'Amount must be a number');
  assert.equal(readMoney(-1).error, 'Amount cannot be less than 0');
  assert.equal(readMoney(MAX_AMOUNT + 1).error, 'Amount is unrealistically large');
});

test('readMoney can require a positive payment', () => {
  // Settling a fine with nothing is not a settlement.
  assert.equal(readMoney(0, { min: 0.01, label: 'Amount' }).error, 'Amount cannot be less than 0.01');
  assert.deepEqual(readMoney(1, { min: 0.01 }), { value: 1 });
});

test('the model setter rounds whatever a caller hands it', () => {
  assert.equal(moneySetter(1400.004), 1400);
  assert.equal(moneySetter(null), null);
  assert.equal(moneySetter(undefined), undefined);
  assert.equal(moneySetter(''), '');
});
