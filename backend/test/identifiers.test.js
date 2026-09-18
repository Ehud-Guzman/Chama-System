// The two values members type their way in with: the national ID that opens the
// gated documents, and the phone number the reminder emails are checked against.
const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeNationalId, storedNationalId } = require('../src/utils/nationalId');
const { normalizePhone } = require('../src/utils/phone');

test('the gate sees one ID however the card is written', () => {
  // Spaces, dashes, slashes and dots are how cards are printed.
  assert.equal(normalizeNationalId('1234 5678'), '12345678');
  assert.equal(normalizeNationalId('1234-5678'), '12345678');
  assert.equal(normalizeNationalId('123/456/789'), '123456789');
  assert.equal(normalizeNationalId('1234.5678'), '12345678');
  assert.equal(normalizeNationalId('a1234567b'), 'A1234567B'); // passport shape
});

test('free text is not a credential', () => {
  // The column also carries notes, and a note must never open a record.
  assert.equal(normalizeNationalId('not yet issued'), null);
  assert.equal(normalizeNationalId('N/A'), null);
  assert.equal(normalizeNationalId(''), null);
  assert.equal(normalizeNationalId(undefined), null);
  assert.equal(normalizeNationalId('1234'), null); // too short to be an ID
  assert.equal(normalizeNationalId('1'.repeat(21)), null);
});

test('what is stored is the ID when there is one, and the note otherwise', () => {
  assert.equal(storedNationalId(' 1234 5678 '), '12345678');
  assert.equal(storedNationalId('not yet issued'), 'not yet issued');
  assert.equal(storedNationalId(''), '');
  assert.equal(storedNationalId(null), '');
  // Notes are capped, the same as the field itself.
  assert.equal(storedNationalId('x'.repeat(100)).length, 40);
});

test('Kenyan mobile numbers collapse to one shape', () => {
  assert.equal(normalizePhone('0712345678'), '0712345678');
  assert.equal(normalizePhone('+254712345678'), '0712345678');
  assert.equal(normalizePhone('254712345678'), '0712345678');
  assert.equal(normalizePhone('712345678'), '0712345678');
  assert.equal(normalizePhone('0712 345 678'), '0712345678');
  assert.equal(normalizePhone('0712-345-678'), '0712345678');
  assert.equal(normalizePhone('0112345678'), '0112345678'); // the 01 range
  assert.equal(normalizePhone('+254112345678'), '0112345678');
});

test('a number that is not a Kenyan mobile is refused', () => {
  assert.equal(normalizePhone('0812345678'), null); // 08 is not mobile
  assert.equal(normalizePhone('071234567'), null); // one digit short
  assert.equal(normalizePhone('07123456789'), null); // one too many
  assert.equal(normalizePhone('not a phone'), null);
  assert.equal(normalizePhone('+25471234567'), null);
  assert.equal(normalizePhone(712345678), null); // a number, not a string
  assert.equal(normalizePhone(''), null);
});
