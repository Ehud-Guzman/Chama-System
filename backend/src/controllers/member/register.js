// The members' controller, part: register. controllers/memberController.js is the index the routes use.

const Member = require('../../models/Member');
const Contribution = require('../../models/Contribution');
const { parseMembersCSV } = require('../../utils/csvImport');
const { normalizePhone } = require('../../utils/phone');
const { cleanEmail, isValidEmail } = require('../../utils/mailer');
const { storedNationalId, normalizeNationalId } = require('../../utils/nationalId');
const { cleanDateOfBirth, cleanText, cleanFamily, normaliseFamily, APPROVAL_ROLES, APPROVAL_LABELS } = require('../../utils/memberDetails');
const { nextOfKinList, nextOfKinListError } = require('../../utils/nextOfKin');
const { logAudit, snapshot } = require('../../utils/auditLogger');
const { toEatDateString } = require('../../utils/weekCycle');
const { sendWorkbook } = require('../../utils/xlsxExport');
const { nonPersonalTypeIds } = require('../../utils/personalTypes');
const { nextRegNumber } = require('./common');

const CSV_IMPORT_ROW_LIMIT = 1000;

// POST /api/members/import — body: { csv: "name,phone,..." }
async function importMembers(req, res, next) {
  try {
    const csv = req.body?.csv;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ message: 'CSV content is required' });
    }

    let rows;
    try {
      rows = parseMembersCSV(csv);
    } catch (err) {
      return res.status(400).json({ message: `Could not read CSV: ${err.message}` });
    }
    if (rows.length > CSV_IMPORT_ROW_LIMIT) {
      return res.status(400).json({
        message: `That file has ${rows.length} rows — please split it into batches of ${CSV_IMPORT_ROW_LIMIT} or fewer.`,
      });
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const row of rows) {
      const { rowNumber, name, phone, email, regNumber, notes } = row;
      if (!name) {
        skipped++;
        errors.push({ row: rowNumber, reason: 'Missing name' });
        continue;
      }
      const normalized = normalizePhone(phone || '');
      if (!normalized) {
        skipped++;
        errors.push({ row: rowNumber, reason: `Invalid phone "${phone || ''}"` });
        continue;
      }
      const rowEmail = cleanEmail(email);
      if (!isValidEmail(rowEmail)) {
        skipped++;
        errors.push({ row: rowNumber, reason: `Invalid email "${email}"` });
        continue;
      }
      const existing = await Member.findOne({ phone: normalized }).select('_id');
      if (existing) {
        skipped++;
        errors.push({ row: rowNumber, reason: `Duplicate phone ${normalized} — already registered` });
        continue;
      }
      // The ID is the key to a member's own record, so the sheet must not hand two
      // members the same one. Same treatment as a duplicate phone: the row is
      // skipped and reported, never written.
      const rowNationalId = storedNationalId(row.nationalId);
      const rowIdKey = normalizeNationalId(rowNationalId);
      if (rowIdKey) {
        const idTaken = await Member.findOne({ nationalId: rowIdKey }).select('name').lean();
        if (idTaken) {
          skipped++;
          errors.push({
            row: rowNumber,
            reason: `ID ${rowIdKey} is already on ${idTaken.name}'s record`,
          });
          continue;
        }
      }
      // A birth date in the sheet has to be a real date — imported silently wrong it
      // would sit on the profile for ever. Blank is fine: the sheet simply does not
      // carry that column.
      const dob = cleanDateOfBirth(row.dateOfBirth);
      if (dob.error) {
        skipped++;
        errors.push({ row: rowNumber, reason: `Invalid date of birth "${row.dateOfBirth}"` });
        continue;
      }
      // The form's emergency contact. A contact named with no way to reach anybody is
      // rejected by the same rule the admin form applies, rather than being dropped
      // silently — the point of the field is that it works in an emergency.
      const kin = nextOfKinList(
        row.emergencyName || row.emergencyPhone || row.emergencyRelationship
          ? [
              {
                name: row.emergencyName,
                relationship: row.emergencyRelationship,
                phone: row.emergencyPhone,
              },
            ]
          : []
      );
      const kinError = nextOfKinListError(kin);
      if (kinError) {
        skipped++;
        errors.push({ row: rowNumber, reason: kinError });
        continue;
      }
      try {
        const member = await Member.create({
          name,
          phone: normalized,
          email: rowEmail,
          regNumber: regNumber || (await nextRegNumber()),
          notes: notes || '',
          // The admission form's own columns, when the sheet has them. The
          // declaration and the three signatures are not importable — those are the
          // people, not the spreadsheet.
          dateOfBirth: dob.value ?? null,
          nationalId: storedNationalId(row.nationalId),
          physicalAddress: cleanText(row.physicalAddress, 240),
          family: cleanFamily({
            spouseName: row.spouseName,
            children: row.children,
            fatherName: row.fatherName,
            motherName: row.motherName,
            fatherInLawName: row.fatherInLawName,
            motherInLawName: row.motherInLawName,
          }),
          nextOfKin: kin,
          createdBy: req.user._id,
        });
        await logAudit({
          action: 'create',
          entityType: 'Member',
          entityId: member._id,
          performedBy: req.user._id,
          after: snapshot(member),
        });
        imported++;
      } catch (err) {
        skipped++;
        errors.push({
          row: rowNumber,
          reason: err.code === 11000 ? 'Duplicate registration number' : err.message,
        });
      }
    }

    res.json({ imported, skipped, errors });
  } catch (err) {
    next(err);
  }
}

// The admission form's own columns, in the order the form asks for them, with the
// heading the import parser recognises. One table for the full export and the blank
// import template, so a template can never offer a heading the parser does not read.
// A date goes in as plain text: SheetJS would otherwise write a serial number whose
// date format the office has to fix by hand before the file reads properly.
const FORM_EXPORT_COLUMNS = [
  ['Date of birth', (m) => isoDay(m.dateOfBirth)],
  ['National ID', (m) => m.nationalId || ''],
  ['Physical address', (m) => m.physicalAddress || ''],
  ['Spouse', (m) => normaliseFamily(m.family).spouseName],
  ['Children', (m) => normaliseFamily(m.family).children.join('; ')],
  ['Father', (m) => normaliseFamily(m.family).fatherName],
  ['Mother', (m) => normaliseFamily(m.family).motherName],
  ['Father-in-law', (m) => normaliseFamily(m.family).fatherInLawName],
  ['Mother-in-law', (m) => normaliseFamily(m.family).motherInLawName],
  // The form's emergency contact, flattened the same way — several contacts are
  // joined so the row stays one row.
  ['Emergency contact', (m) => nextOfKinList(m.nextOfKin).map((k) => k.name).join('; ')],
  ['Emergency relationship', (m) => nextOfKinList(m.nextOfKin).map((k) => k.relationship).join('; ')],
  ['Emergency phone', (m) => nextOfKinList(m.nextOfKin).map((k) => k.phone).join('; ')],
];

// Both sides of the form the office signs by hand. Kept as columns so a member's
// paperwork can be audited from the export without opening each profile.
const SIGNATURE_EXPORT_COLUMNS = [
  ['Declaration signed by', (m) => (m.commitment?.agreed ? m.commitment.signedBy || 'yes' : '')],
  ['Declaration date', (m) => isoDay(m.commitment?.agreedAt)],
  ...APPROVAL_ROLES.map((role) => [approvalLabel(role), (m) => approvalName(m, role)]),
  ...APPROVAL_ROLES.map((role) => [`${approvalLabel(role)} date`, (m) => approvalDay(m, role)]),
];

function isoDay(value) {
  if (!value) return '';
  const date = new Date(value);
  // Read back in EAT, the way the office wrote it. `toISOString().slice(0,10)` reads the instant in
  // UTC instead, and a date of birth is not an instant: one entered as "17 Apr 1990" is stored at
  // midnight in the server's own zone, which from a UTC server renders as the *16th* — a birth date
  // exported a day early, and one the office would have no reason to doubt. This is the same helper
  // the statements print their period labels with, so the two exports agree about what day it is.
  return Number.isNaN(date.getTime()) ? '' : toEatDateString(date);
}

function approvalLabel(role) {
  return APPROVAL_LABELS[role] || role;
}

function approvalName(member, role) {
  const match = (member.approvals || []).find((a) => a.role === role);
  return match ? match.name : '';
}

function approvalDay(member, role) {
  const match = (member.approvals || []).find((a) => a.role === role);
  return match ? isoDay(match.signedAt) : '';
}

// GET /api/members/import-template — blank .xlsx with the exact columns
// importMembers reads, plus one filled example row so the format is obvious.
async function importTemplate(req, res, next) {
  try {
    const blank = Object.fromEntries(
      [['name', ''], ['phone', ''], ['email', ''], ['regNumber', ''], ...FORM_EXPORT_COLUMNS.map(([h]) => [h, '']), ['notes', '']]
    );
    const example = {
      ...blank,
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
    sendWorkbook(res, 'members-import-template.xlsx', [{ name: 'Members', rows: [example, blank] }]);
  } catch (err) {
    next(err);
  }
}

// GET /api/members/export — .xlsx workbook download
async function exportMembers(req, res, next) {
  try {
    const members = await Member.find().sort({ name: 1 }).lean();
    const ids = members.map((m) => m._id);
    const excludedTypeIds = await nonPersonalTypeIds();
    const sums = await Contribution.aggregate([
      { $match: { memberId: { $in: ids }, deleted: false, typeId: { $nin: excludedTypeIds } } },
      { $group: { _id: '$memberId', total: { $sum: '$amount' } } },
    ]);
    const sumMap = new Map(sums.map((s) => [String(s._id), s.total]));

    const sheetRows = members.map((m) => ({
      Name: m.name,
      Phone: m.phone,
      Email: m.email || '',
      'Reg number': m.regNumber || '',
      // Everything the membership admission form asks for, then what the register
      // itself knows — so one export answers both "who is this member" and "what has
      // he paid".
      ...Object.fromEntries(FORM_EXPORT_COLUMNS.map(([header, read]) => [header, read(m)])),
      ...Object.fromEntries(SIGNATURE_EXPORT_COLUMNS.map(([header, read]) => [header, read(m)])),
      'Total contributed': sumMap.get(String(m._id)) || 0,
      Status: m.active ? 'active' : 'inactive',
      Notes: m.notes || '',
    }));
    sendWorkbook(res, 'members.xlsx', [{ name: 'Members', rows: sheetRows }]);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  exportMembers,
  importMembers,
  importTemplate,
};
