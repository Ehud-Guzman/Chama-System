const { parse } = require('csv-parse/sync');

// Parses member CSV content. Expected columns: name, phone, regNumber (optional), notes (optional).
// Header names are matched case-insensitively; extra columns are ignored.
// Returns [{ rowNumber, name, phone, regNumber, notes }] — rowNumber is the line in the
// original file (header = row 1), so error reports point at the right line.
function parseMembersCSV(csv) {
  const records = parse(csv, {
    columns: (header) => header.map((h) => String(h).trim().toLowerCase()),
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  return records.map((rec, i) => ({
    rowNumber: i + 2,
    name: String(rec.name || '').trim(),
    phone: String(rec.phone || '').trim(),
    regNumber: String(rec.regnumber || rec['reg number'] || rec.reg_no || '').trim(),
    notes: String(rec.notes || '').trim(),
  }));
}

module.exports = { parseMembersCSV };
