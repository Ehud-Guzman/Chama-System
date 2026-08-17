// Adds/refreshes a "Totals" sheet showing what was collected each week
// (contributions + chai + extra, member rows only). Reads the Ledger sheet,
// never writes to it — only adds or replaces the separate "Totals" tab.
// Because importLedgerIncremental.js only ever reads workbook.Sheets.Ledger,
// this sheet has zero effect on import. Safe to re-run any time.
//
// Usage:
//   node src/scripts/addWeekTotals.js
//   node src/scripts/addWeekTotals.js --file="C:\path\ledger.xlsx"

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const CHAI_WEEKLY_AMOUNT = 100;

const fileArg = process.argv.find((arg) => arg.startsWith('--file='));

const DEFAULT_FILE = path.resolve(
  __dirname,
  '../../data/ledger_weeks_62_84_template.xlsx'
);

const TARGET_FILE = path.resolve(
  fileArg ? fileArg.slice('--file='.length) : DEFAULT_FILE
);


function cleanKey(key) {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '');
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value || '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function emptyToZero(value) {
  const number = toNumber(value);
  return number == null ? 0 : number;
}

// Contribution can be a number, "NIL", or "PAID" — mirrors
// importLedgerIncremental.js's parseAmountOrStatus. NIL/PAID contribute 0 to
// the collected total.
function contributionAmount(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return value;
  const raw = String(value).trim();
  if (/^(nil|paid)$/i.test(raw)) return 0;
  return toNumber(raw) || 0;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return '';
  return date.toISOString().slice(0, 10);
}


function main() {
  if (!fs.existsSync(TARGET_FILE)) {
    throw new Error(`File not found: ${TARGET_FILE}`);
  }

  const workbook = XLSX.readFile(TARGET_FILE, { cellDates: true });
  const sheet = workbook.Sheets.Ledger;

  if (!sheet) {
    throw new Error('No Ledger sheet found in workbook.');
  }

  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const weeks = new Map();
  // week -> { date, contributions, chai, extra }

  for (const raw of rawRows) {
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      out[cleanKey(key)] = value;
    }

    const rowType = String(out.rowtype || 'member').trim().toLowerCase();
    if (rowType !== 'member') continue;

    const week = toNumber(out.week);
    if (!week) continue;

    if (!weeks.has(week)) {
      weeks.set(week, { date: out.date, contributions: 0, chai: 0, extra: 0 });
    }

    const bucket = weeks.get(week);

    if (!bucket.date && out.date) bucket.date = out.date;

    bucket.contributions += contributionAmount(out.contribution);

    const chai = out.chai === '' || out.chai == null
      ? CHAI_WEEKLY_AMOUNT
      : (toNumber(out.chai) ?? CHAI_WEEKLY_AMOUNT);
    bucket.chai += chai;

    bucket.extra += emptyToZero(out.extra);
  }

  const totalsRows = [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, bucket]) => ({
      Week: week,
      Date: formatDate(bucket.date instanceof Date ? bucket.date : new Date(bucket.date)),
      'Contributions Collected': bucket.contributions,
      'Chai Collected': bucket.chai,
      'Extra Collected': bucket.extra,
      'Total Collected': bucket.contributions + bucket.chai + bucket.extra,
    }));

  const totalsSheet = XLSX.utils.json_to_sheet(totalsRows);

  workbook.Sheets.Totals = totalsSheet;
  if (!workbook.SheetNames.includes('Totals')) {
    workbook.SheetNames.push('Totals');
  }

  XLSX.writeFile(workbook, TARGET_FILE);

  console.log(`Totals sheet written: ${totalsRows.length} week(s) — ${TARGET_FILE}`);
}

main();