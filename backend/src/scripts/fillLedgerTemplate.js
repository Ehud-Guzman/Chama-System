// Helper for filling the shared ledger_weeks_61_86_template.xlsx one week at
// a time as paper-ledger photos come in, without touching other weeks'
// already-filled rows. Re-run safely — it only overwrites cells for the week
// passed to applyWeek().
//
// Usage from another script:
//   const { applyWeek } = require('./fillLedgerTemplate');
//   applyWeek(61, {
//     date: '2026-02-12',
//     members: { 'Evans Ndungu': { contribution: 2500, previous: 94100 }, ... },
//     groups: {
//       // Groups that only ever have one row per week can key by rowType alone:
//       fines_penalties: { contribution: 21500, previous: 47400 },
//       // Groups that can have several rows in the same week (e.g. multiple
//       // expense line items sharing rowType "expense") must key by
//       // "rowType:name" instead, so each row gets its own patch:
//       'expense:Dowry': { expense_amount: 232000 },
//       'expense:Land Purchase': { expense_amount: 2590000 },
//     },
//   });

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const TEMPLATE_PATH = path.resolve(__dirname, '../../data/ledger_weeks_62_84_template.xlsx');

function applyWeek(weekNumber, { date, members = {}, groups = {} }) {
  if (!fs.existsSync(TEMPLATE_PATH)) throw new Error(`Template not found: ${TEMPLATE_PATH}`);
  const workbook = XLSX.readFile(TEMPLATE_PATH);
  const sheet = workbook.Sheets.Ledger;
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  let updated = 0;
  for (const row of rows) {
    // FIXED: the header cell is "Week" (capital W). sheet_to_json() keys
    // rows by the exact header text, so this was `row.week` before — always
    // undefined, meaning `Number(row.week) !== weekNumber` was always true
    // and every row got skipped. applyWeek() has never actually written a
    // row until this fix.
    if (Number(row.Week) !== weekNumber) continue;

    const patch = row.rowType === 'member'
      ? members[row.name]
      // FIXED (design gap, not a typo): a plain `groups[row.rowType]` lookup
      // can only hold one patch per rowType per week, so two rows sharing a
      // rowType (e.g. two "expense" lines in the same week) would collide —
      // both would receive whichever patch was assigned last. Try the more
      // specific "rowType:name" key first, and fall back to the old
      // rowType-only key for groups that only ever have one row per week.
      : (groups[`${row.rowType}:${row.name}`] || groups[row.rowType]);

    if (!patch) continue;
    if (date) row.date = date;
    Object.assign(row, patch);
    updated++;
  }

  if (updated === 0) {
    // NEW: this used to fail silently — 0 rows written, no error, no clue
    // why. Surface it so a bad week number or empty patch doesn't slip by.
    console.warn(`Week ${weekNumber}: no matching rows found — check the week number and that members/groups keys match the sheet's "name"/"rowType" values.`);
  }

  const newSheet = XLSX.utils.json_to_sheet(rows);
  newSheet['!cols'] = sheet['!cols'];
  workbook.Sheets.Ledger = newSheet;
  XLSX.writeFile(workbook, TEMPLATE_PATH);
  console.log(`Week ${weekNumber}: filled ${updated} row(s) in ${TEMPLATE_PATH}`);
  return updated;
}

module.exports = { applyWeek, TEMPLATE_PATH };