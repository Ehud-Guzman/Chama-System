const { parse } = require('csv-parse/sync');
const { undoSanitizeCell } = require('./xlsxExport');

// Parses member CSV content. Expected columns: name, phone. Optional: email,
// regNumber, notes, and the membership admission form's own fields — dateOfBirth,
// nationalId, physicalAddress, spouseName, children, fatherName, motherName,
// fatherInLawName, motherInLawName. Header names are matched case-insensitively;
// extra columns are ignored.
// Returns [{ rowNumber, name, phone, email, regNumber, notes, ...form fields }] —
// rowNumber is the line in the original file (header = row 1), so error reports
// point at the right line.
//
// Every value read here also passes through the export guard's inverse, so a roster
// that came out of this system goes back in unchanged — see the note on
// `undoSanitizeCell` in utils/xlsxExport for why that matters.
function parseMembersCSV(csv) {
  const records = parse(csv, {
    columns: (header) => header.map((h) => String(h).trim().toLowerCase()),
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  // One value, several spellings: the office writes the header by hand, so
  // "date of birth", "dateofbirth" and headings copied off the paper form all have
  // to land on the same field.
  const pick = (rec, names) => {
    for (const name of names) {
      const value = rec[name];
      if (value !== undefined && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };

  return records.map((rec, i) => {
    const row = {
      rowNumber: i + 2,
      name: String(rec.name || '').trim(),
      phone: String(rec.phone || '').trim(),
      email: String(rec.email || rec['e-mail'] || rec['email address'] || '').trim(),
      regNumber: String(rec.regnumber || rec['reg number'] || rec.reg_no || '').trim(),
      notes: String(rec.notes || '').trim(),
      dateOfBirth: pick(rec, ['dateofbirth', 'date of birth', 'dob', 'birth date']),
      nationalId: pick(rec, ['nationalid', 'national id', 'id number', 'idnumber', 'id']),
      physicalAddress: pick(rec, ['physicaladdress', 'physical address', 'address', 'residence']),
      spouseName: pick(rec, ['spousename', 'spouse', 'spouse name']),
      children: pick(rec, ['children', "children's names", 'childrens names']),
      fatherName: pick(rec, ['fathername', 'father', 'father name']),
      motherName: pick(rec, ['mothername', 'mother', 'mother name']),
      fatherInLawName: pick(rec, ['fatherinlaw', 'father in law', 'father-in-law', "father in law's name"]),
      motherInLawName: pick(rec, ['motherinlaw', 'mother in law', 'mother-in-law', "mother in law's name"]),
      // The form's emergency contact, which the export writes back out under the same
      // headings, so an exported roster can be re-imported unchanged.
      emergencyName: pick(rec, ['emergency contact', 'emergencycontact', 'next of kin', 'nextofkin', 'kin']),
      emergencyRelationship: pick(rec, ['emergency relationship', 'relationship']),
      emergencyPhone: pick(rec, ['emergency phone', 'emergencyphone', 'kin phone', 'next of kin phone']),
    };

    // The export guard's inverse, applied to every field at once — including any added
    // later, which is the point of doing it here rather than field by field.
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, undoSanitizeCell(value)])
    );
  });
}

module.exports = { parseMembersCSV };
