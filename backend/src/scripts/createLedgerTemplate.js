const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const START_WEEK = 61;
const END_WEEK = 86;
const END_DATE = new Date('2026-08-06T12:00:00Z');

const MEMBERS = [
  'Evans Ndungu',
  'Patrick Njuguna',
  'Benard Ngugi',
  'Ndungu Mbugua',
  'Joseph Ndegwa',
  'Victor Kamau',
  'Peter Kimotho',
  'Samson Mwangi',
  'David Njoroge',
  'John Gatimu',
  'Joel Ndungu',
  'Benson Maina',
  'Benson Kaniu',
  'Eustace Mugwanja',
  'Joseph Gitonga',
  'Wilson Kabichu',
  'James Gachara',
  'Erick Mwangi',
  'Erick Njogu',
  'Dennis Wasike',
  'Samuel Gachara',
  'Zabron Macharia',
  'Paul Kimani',
  'Dickson Karethi',
  'Jackson Nakhulo',
  'Isaiah Maina',
  'Harrison Kamau',
  'Stanly Gachara',
  'George Ngechu',
  'Joshua Maina',
  'Isaac Njenga',
  'John Maina',
];

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
for (let week = START_WEEK; week <= END_WEEK; week++) {
  const date = dateForWeek(week);
  for (const name of MEMBERS) rows.push(rowBase(week, date, 'member', name));
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
