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
//     groups: { fines_penalties: { contribution: 21500, previous: 47400 }, ... },
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
    if (Number(row.week) !== weekNumber) continue;
    const patch = row.rowType === 'member' ? members[row.name] : groups[row.rowType];
    if (!patch) continue;
    if (date) row.date = date;
    Object.assign(row, patch);
    updated++;
  }

  const newSheet = XLSX.utils.json_to_sheet(rows);
  newSheet['!cols'] = sheet['!cols'];
  workbook.Sheets.Ledger = newSheet;
  XLSX.writeFile(workbook, TEMPLATE_PATH);
  console.log(`Week ${weekNumber}: filled ${updated} row(s) in ${TEMPLATE_PATH}`);
  return updated;
}

module.exports = { applyWeek, TEMPLATE_PATH };
