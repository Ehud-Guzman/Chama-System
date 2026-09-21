// Out through the workbook and back in through the importer.
//
// The claim being checked is the parser's own: an exported roster can be re-imported unchanged.
// It is checked by running the real pipeline rather than by reading it — sendWorkbook writes the
// file, the same SheetJS call the browser makes (`sheet_to_csv`) turns it back into text, and
// parseMembersCSV reads that text. Nothing here is a stand-in for the code that does the work.
//
// This exists because the round trip was broken in one specific way that no test covered: the
// export's formula guard prefixes a quote to anything starting with =, +, - or @, and the quote is
// a character in the cell. A next-of-kin phone of `+254712345678` therefore came back as
// `'+254712345678` — a contact number that does not work — and a note of `-50 owed` came back
// quoted. The guard is right to exist; the way back has to undo it.
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const { sendWorkbook, undoSanitizeCell } = require('../src/utils/xlsxExport');
const { parseMembersCSV } = require('../src/utils/csvImport');
const { normalizePhone } = require('../src/utils/phone');
const { cleanDateOfBirth } = require('../src/utils/memberDetails');

// sendWorkbook writes to a response; capturing the buffer is all a stub needs to do.
function workbookBuffer(rows, sheetName = 'Members') {
  let buffer = null;
  sendWorkbook(
    {
      setHeader() {},
      send(payload) {
        buffer = payload;
      },
    },
    'round-trip.xlsx',
    [{ name: sheetName, rows }]
  );
  return buffer;
}

// Exactly what CSVImportModal does with an uploaded .xlsx.
function asTheBrowserReadsIt(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
}

test('an exported member row comes back through the importer unchanged', () => {
  const row = {
    Name: 'Jane Wanjiru',
    Phone: '0712345678',
    Email: 'jane@example.com',
    'Reg number': 'R/001',
    'Date of birth': '1990-04-17',
    'National ID': '01234567',
    'Physical address': 'Kiambu',
    'Emergency contact': 'Peter Wanjiru',
    'Emergency relationship': 'Spouse',
    'Emergency phone': '+254712345678',
    Notes: '-50 owed from last week',
    // Columns the importer has no field for: it ignores them rather than stumbling.
    'Total contributed': 1400,
    Status: 'active',
  };

  const [parsed] = parseMembersCSV(asTheBrowserReadsIt(workbookBuffer([row])));

  assert.equal(parsed.name, 'Jane Wanjiru');
  // The phone that has to keep working: normalized to the one format the system stores.
  assert.equal(normalizePhone(parsed.phone), '0712345678');
  assert.equal(parsed.email, 'jane@example.com');
  assert.equal(parsed.regNumber, 'R/001');
  // A date goes out as text and comes back as a date, not as a serial number.
  assert.deepEqual(cleanDateOfBirth(parsed.dateOfBirth), {
    value: new Date('1990-04-17T00:00:00.000Z'),
  });
  // A national ID keeps its leading zero — as a number it would not have one.
  assert.equal(parsed.nationalId, '01234567');
  assert.equal(parsed.physicalAddress, 'Kiambu');
  assert.equal(parsed.emergencyName, 'Peter Wanjiru');
  assert.equal(parsed.emergencyRelationship, 'Spouse');
  // The two that the formula guard used to spoil, now unspoiled by its inverse.
  assert.equal(parsed.emergencyPhone, '+254712345678');
  assert.equal(parsed.notes, '-50 owed from last week');
});

test('the guard still stops a value being a live formula in the file', () => {
  // The security half of the same round trip. If this ever fails, the file has become dangerous
  // to open and the import fix would be pointless: it would just be handing the formula back.
  const buffer = workbookBuffer([{ Notes: '=SUM(A1:A9)' }], 'Notes');
  const sheet = XLSX.read(buffer, { type: 'buffer' }).Sheets.Notes;

  const cell = sheet.A2;
  assert.equal(cell.f, undefined, 'no cell may carry a live formula');
  assert.equal(cell.t, 's', 'the value must be stored as text');
  assert.equal(cell.v, "'=SUM(A1:A9)", 'the guard quote is what keeps it inert');

  // And a file that came from the system goes back in as the office wrote it, not as the guard
  // left it. Both halves have to be true at once.
  const [parsed] = parseMembersCSV(asTheBrowserReadsIt(buffer));
  assert.equal(parsed.notes, '=SUM(A1:A9)');
});

test('an apostrophe the office typed themselves is left alone', () => {
  // Only a quote the guard would have added is removed. A note that genuinely starts with an
  // apostrophe is somebody's handwriting, and eating it would be its own small corruption.
  assert.equal(undoSanitizeCell("'quoted from the minutes"), "'quoted from the minutes");
  assert.equal(undoSanitizeCell("''=double"), "''=double");

  const [parsed] = parseMembersCSV(
    asTheBrowserReadsIt(workbookBuffer([{ Notes: "'quoted from the minutes" }], 'Notes'))
  );
  assert.equal(parsed.notes, "'quoted from the minutes");
});

test('a phone typed into Excel as a number still lands as a phone', () => {
  // The other way this goes wrong: the office types a number, Excel stores 712345678, and the
  // leading zero is gone before the importer ever sees it. normalizePhone knows about that shape.
  const [parsed] = parseMembersCSV('name,phone\nJane Wanjiru,712345678\n');
  assert.equal(parsed.phone, '712345678');
  assert.equal(normalizePhone(parsed.phone), '0712345678');
});

test('the template the office is handed fills in and imports', () => {
  // The example row the import template ships with: if it did not survive a trip through a
  // spreadsheet, the template would be teaching the wrong format.
  const example = {
    name: 'Jane Wanjiru',
    phone: '0712345678',
    email: 'jane@example.com',
    regNumber: '',
    'Date of birth': '1990-04-17',
    'National ID': '12345678',
    'Physical address': 'Kiambu',
    Spouse: 'Peter Wanjiru',
    Children: 'Ann; Brian',
    Father: 'James Wanjiru',
    Mother: 'Mary Wanjiru',
    'Emergency contact': 'Peter Wanjiru',
    'Emergency relationship': 'Spouse',
    'Emergency phone': '0722000111',
    notes: 'Optional note',
  };

  const [parsed] = parseMembersCSV(asTheBrowserReadsIt(workbookBuffer([example])));

  assert.equal(normalizePhone(parsed.phone), '0712345678');
  assert.deepEqual(cleanDateOfBirth(parsed.dateOfBirth), {
    value: new Date('1990-04-17T00:00:00.000Z'),
  });
  assert.equal(parsed.nationalId, '12345678');
  assert.equal(parsed.children, 'Ann; Brian');
  assert.equal(parsed.spouseName, 'Peter Wanjiru');
  assert.equal(parsed.emergencyPhone, '0722000111');
  assert.equal(parsed.notes, 'Optional note');
});
