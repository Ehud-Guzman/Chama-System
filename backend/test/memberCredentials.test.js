const test = require('node:test');
const assert = require('node:assert/strict');

const {
  credentialChangeRefused,
  isRecorded,
  sameValue,
} = require('../src/utils/memberCredentials');

const KIN = [{ name: 'Mary', relationship: 'Spouse', phone: '0722000111', email: '' }];

test('an admin may change any of the three fields', () => {
  for (const role of ['super_admin', 'admin']) {
    assert.equal(
      credentialChangeRefused(role, [
        { field: 'nationalId', before: '12345678', after: '87654321' },
        { field: 'phone', before: '0722000111', after: '0733000222' },
        { field: 'nextOfKin', before: KIN, after: [] },
      ]),
      null,
      role
    );
  }
});

test('a blank field is one the office is still filling in, whoever is filling it', () => {
  // The register is full of records entered from a name and a phone number, and the office chases
  // the members who have no ID. Recording one is not the same act as replacing one.
  assert.equal(
    credentialChangeRefused('treasurer', [
      { field: 'nationalId', before: '', after: '12345678' },
      { field: 'nextOfKin', before: [], after: KIN },
    ]),
    null
  );
  // A new member's record has nothing to protect: every field is a recording.
  assert.equal(
    credentialChangeRefused('treasurer', [
      { field: 'nationalId', before: '', after: '12345678' },
      { field: 'phone', before: '', after: '0722000111' },
    ]),
    null
  );
});

test('a treasurer may not replace a value that is already on the record', () => {
  for (const [field, label] of [
    ['nationalId', 'ID number'],
    ['phone', 'phone number'],
    ['nextOfKin', 'next of kin'],
  ]) {
    const before = field === 'nextOfKin' ? KIN : '0722000111';
    const after = field === 'nextOfKin' ? [{ name: 'John', relationship: 'Brother', phone: '', email: '' }] : '0799888777';
    const refused = credentialChangeRefused('treasurer', [{ field, before, after }]);
    assert.match(refused, new RegExp(label), field);
    assert.match(refused, /admin/i, field);
  }
});

test('clearing a value is a change too — the door is not taken off by leaving a box empty', () => {
  assert.match(
    credentialChangeRefused('treasurer', [{ field: 'nationalId', before: '12345678', after: '' }]),
    /ID number/
  );
  assert.match(
    credentialChangeRefused('treasurer', [{ field: 'nextOfKin', before: KIN, after: [] }]),
    /next of kin/
  );
});

test('sending the same value back is not a change, so the rest of the form still saves', () => {
  // The member form posts every field it holds. A treasurer editing a member's notes sends the
  // member's ID, phone and contacts back unchanged, and that must not be read as an attempt to
  // change them — otherwise no treasurer could edit anything.
  assert.equal(
    credentialChangeRefused('treasurer', [
      { field: 'nationalId', before: '12345678', after: '12345678' },
      { field: 'phone', before: '0722000111', after: ' 0722000111 ' },
      { field: 'nextOfKin', before: KIN, after: KIN },
      { field: 'name', before: 'John Kamau', after: 'John M. Kamau' },
    ]),
    null
  );
});

test('the first refused change is the one named', () => {
  const refused = credentialChangeRefused('treasurer', [
    { field: 'nationalId', before: '12345678', after: '12345678' },
    { field: 'phone', before: '0722000111', after: '0799888777' },
  ]);
  assert.match(refused, /phone number/);
});

test('isRecorded tells an empty field from a filled one, on both shapes', () => {
  for (const value of ['', '   ', null, undefined, []]) {
    assert.equal(isRecorded(value), false, JSON.stringify(value));
  }
  for (const value of ['12345678', KIN]) {
    assert.equal(isRecorded(value), true, JSON.stringify(value));
  }
});

test('sameValue ignores spacing and compares contacts entry by entry', () => {
  assert.equal(sameValue(' 0722000111 ', '0722000111'), true);
  assert.equal(sameValue('0722000111', '0733000222'), false);
  assert.equal(sameValue(KIN, [...KIN]), true);
  assert.equal(sameValue(KIN, []), false);
});
