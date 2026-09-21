const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanDateOfBirth } = require('../src/utils/memberDetails');

const day = (result) => {
  assert.equal(result.error, undefined, `unexpected refusal: ${result.error}`);
  return result.value.toISOString().slice(0, 10);
};

test('a date written day-first is read the way the office writes it', () => {
  // The bug this pins: JavaScript reads a slash-separated date as American month-first, so
  // `05/04/1990` was stored as 4 May when the treasurer meant 5 April, and nothing said so.
  assert.equal(day(cleanDateOfBirth('05/04/1990')), '1990-04-05');
  assert.equal(day(cleanDateOfBirth('17/04/1990')), '1990-04-17');
  assert.equal(day(cleanDateOfBirth('1/4/1990')), '1990-04-01');
  // Dashes are the same date, not a different one.
  assert.equal(day(cleanDateOfBirth('17-04-1990')), '1990-04-17');
  assert.equal(day(cleanDateOfBirth('17.04.1990')), '1990-04-17');
});

test('ISO is untouched, because that is what the form and the template send', () => {
  for (const value of ['1990-04-17', '1990-4-17', '1990/04/17']) {
    assert.equal(day(cleanDateOfBirth(value)), '1990-04-17', value);
  }
});

test('a two-digit year is read as a year a birth date could be', () => {
  assert.equal(day(cleanDateOfBirth('17/04/90')), '1990-04-17');
  assert.equal(day(cleanDateOfBirth('17/04/05')), '2005-04-17');
});

test('a date that does not exist is refused, never rolled forward', () => {
  // 31 April is a typo. JavaScript would hand back 1 May and somebody would never know the
  // record was wrong — which is the whole reason this function refuses rather than guesses.
  assert.match(cleanDateOfBirth('31/04/1990').error, /valid date/);
  assert.match(cleanDateOfBirth('30/02/2000').error, /valid date/);
  assert.match(cleanDateOfBirth('32/01/1990').error, /valid date/);
  assert.match(cleanDateOfBirth('17/13/1990').error, /valid date/);
});

test('the checks that were already there still hold', () => {
  assert.match(cleanDateOfBirth('01/01/2030').error, /future/);
  assert.match(cleanDateOfBirth('01/01/1850').error, /too far back/);
  assert.match(cleanDateOfBirth('not a date').error, /valid date/);
  // Blank is allowed: most of the register was entered from a name and a phone number.
  assert.deepEqual(cleanDateOfBirth(''), { value: null });
  assert.deepEqual(cleanDateOfBirth(undefined), { value: undefined });
});

test('a Date the API sent is not re-parsed as text', () => {
  const sent = new Date('1990-04-17T00:00:00.000Z');
  assert.equal(day(cleanDateOfBirth(sent)), '1990-04-17');
});
