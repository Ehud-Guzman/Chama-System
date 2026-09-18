// The member roster importer.
//
// This is the one place where a file comes from outside the app and is read with a
// CSV parser (csv-parse), from user-supplied header names. It has to cope with the
// headings the office actually writes by hand, and it must never let a header name
// become a property of the object it builds.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseMembersCSV } = require('../src/utils/csvImport');

test('a plain roster parses with its line numbers', () => {
  const rows = parseMembersCSV('name,phone,email\nAlice Mwangi,0712345678,a@example.com\nBob Otieno,0723456789,\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    rowNumber: 2,
    name: 'Alice Mwangi',
    phone: '0712345678',
    email: 'a@example.com',
    regNumber: '',
    notes: '',
    dateOfBirth: '',
    nationalId: '',
    physicalAddress: '',
    spouseName: '',
    children: '',
    fatherName: '',
    motherName: '',
    fatherInLawName: '',
    motherInLawName: '',
    emergencyName: '',
    emergencyRelationship: '',
    emergencyPhone: '',
  });
  assert.equal(rows[1].rowNumber, 3);
  assert.equal(rows[1].name, 'Bob Otieno');
});

test('headers are matched case-insensitively and by several spellings', () => {
  const rows = parseMembersCSV(
    'Name,Phone,National ID,Date Of Birth,Next of Kin,Kin Phone,Reg Number\n'
      + 'Alice,0712345678,12345678,1985-04-02,Peter Mwangi,0700111222,M/001\n'
  );
  assert.equal(rows[0].nationalId, '12345678');
  assert.equal(rows[0].dateOfBirth, '1985-04-02');
  assert.equal(rows[0].emergencyName, 'Peter Mwangi');
  assert.equal(rows[0].emergencyPhone, '0700111222');
  assert.equal(rows[0].regNumber, 'M/001');
});

test('a UTF-8 BOM and blank lines do not shift the row numbers', () => {
  const rows = parseMembersCSV('\uFEFFname,phone\n\nAlice,0712345678\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Alice');
  assert.equal(rows[0].phone, '0712345678');
});

test('unknown columns are dropped and a missing field is an empty string', () => {
  const rows = parseMembersCSV('name,phone,favourite colour\nAlice,0712345678,blue\n');
  assert.equal(rows[0].name, 'Alice');
  assert.equal(rows[0].notes, '');
  assert.equal(rows[0]['favourite colour'], undefined);
});

test('a header cannot reach into the row object\'s prototype', () => {
  // csv-parse turns each header into a key of the record it builds, and a
  // hand-written file can name a column anything. The row must stay an ordinary
  // object with the shared prototype untouched.
  const rows = parseMembersCSV('name,__proto__,constructor\nAlice,17,boom\n');
  assert.equal(rows[0].name, 'Alice');
  assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype);
  assert.equal({}.constructor, Object);
  assert.equal({}.name, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});
