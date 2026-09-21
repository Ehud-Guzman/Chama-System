const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const START_WEEK = 61;
const END_WEEK = 86;
const END_DATE = new Date('2026-08-06T12:00:00Z');

// The group's 32 member names used to be listed here, hard-coded. They are gone, and they are not
// coming back: this repository is public, and the README's own rule is that member data does not
// live in the tree. This file also generated `ledger_weeks_61_86_template.xlsx` — one of the files
// the README records as having been exposed and purged — so a list of the group's members sitting
// next to it was the same mistake, caught later.
//
// The names here are only row labels on a sheet the office fills in, so they are read from a file
// the office keeps OUTSIDE the repository, one name to a line:
//
//   node src/scripts/createLedgerTemplate.js --members=/path/to/names.txt
//
// There is deliberately no fallback list. A template that quietly writes 32 placeholder rows looks
// like a template, gets filled in, and is wrong in a way nobody notices until the money does not
// add up — so a missing argument stops the script instead.
function readMembers() {
  const arg = process.argv.slice(2).find((value) => value.startsWith('--members='));
  if (!arg) {
    console.error('\n  --members=<file> is required: one member name per line.');
    console.error('  Keep that file outside this repository — the names are member data.\n');
    process.exit(2);
  }
  const file = arg.slice('--members='.length);
  const names = fs
    .readFileSync(path.resolve(file), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (names.length === 0) {
    console.error(`\n  ${file} has no names in it.\n`);
    process.exit(2);
  }
  return names;
}

const GROUP_ROWS = [
  ['fines_penalties', 'Fines/Penalties'],
  ['tea_balance', 'Tea Balance'],
  ['registration', 'Registration'],
  ['resignation', 'Resignation'],
];

function dateForWeek(week) {
  const d = new Date(END_DATE);
  d.setUTCDate(d.getUTCDate() - (END_WEEK - week) * 7);
  return d.toISOString().slice(0, 10);
}

function rowBase(week, date, rowType, name) {
  return {
    week,
    date,
    rowType,
    name,
    contribution: '',
    chai: rowType === 'member' ? 100 : '',
    debt: '',
    extra: '',
    previous: '',
    total: '',
    note: '',
  };
}

const rows = [];
const members = readMembers();
for (let week = START_WEEK; week <= END_WEEK; week++) {
  const date = dateForWeek(week);
  for (const name of members) rows.push(rowBase(week, date, 'member', name));
  for (const [rowType, name] of GROUP_ROWS) rows.push(rowBase(week, date, rowType, name));
}

const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.json_to_sheet(rows);
worksheet['!cols'] = [
  { wch: 8 },
  { wch: 12 },
  { wch: 18 },
  { wch: 24 },
  { wch: 14 },
  { wch: 10 },
  { wch: 10 },
  { wch: 10 },
  { wch: 14 },
  { wch: 14 },
  { wch: 42 },
];
XLSX.utils.book_append_sheet(workbook, worksheet, 'Ledger');

const outDir = path.resolve(__dirname, '../../data');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'ledger_weeks_61_86_template.xlsx');
XLSX.writeFile(workbook, outPath);

console.log(`Created ${outPath}`);
