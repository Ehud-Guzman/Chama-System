// Incremental ledger import: appends weeks from the shared xlsx template
// (data/ledger_weeks_62_84_template.xlsx by default) on top of the REAL,
// already-live data from weeks 60-61 — it never wipes anything. Every write
// is guarded by a lookup on a unique note/description string, so re-running
// this script (e.g. after adding more weeks to the sheet) only creates
// records for rows it hasn't already imported.
//
// Modeling choice vs. the old per-week scripts (importWeek60/61Ledger.js):
// those logged Chai as an untied, member-less Expense (1,400 + 100 flat,
// same for every member row, no memberId field on Expense at all) — that
// has zero visible effect anywhere in the app (Weekly Contribution isn't a
// tracksExpenses type) and doesn't match how the live weekly-logging screen
// (BulkContributionGrid) works. From week 62 onward this instead logs each
// member's 100 Chai as a real Contribution on the Chai type, same as every
// other week logged through the app — visible on their ledger, correctly
// excluded from their personal total (Chai isGroupFund), and counted by
// fundBalance(). The "tea_balance" group row's own figure keeps meaning the
// same as before: money collected *beyond* the per-member 100s.
//
//   node src/scripts/importLedgerIncremental.js                  (dry run)
//   node src/scripts/importLedgerIncremental.js --confirm-import  (writes)
//   node src/scripts/importLedgerIncremental.js --file=data/foo.xlsx

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');

const User = require('../models/User');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const Expense = require('../models/Expense');
const { logAudit, snapshot } = require('../utils/auditLogger');

const CONFIRMED = process.argv.includes('--confirm-import');
const fileArg = process.argv.find((arg) => arg.startsWith('--file='));
const DEFAULT_FILE = path.resolve(__dirname, '../../data/ledger_weeks_62_84_template.xlsx');
const INPUT_FILE = path.resolve(fileArg ? fileArg.slice('--file='.length) : DEFAULT_FILE);

// Weeks 60-61 are already real, imported by the dedicated one-off scripts —
// any row for those weeks found in a shared sheet is intentionally ignored
// here rather than risk a second, differently-shaped entry for the same week.
const FIRST_INCREMENTAL_WEEK = 62;
const CHAI_WEEKLY_AMOUNT = 100;
const SYSTEM_MEMBER_NAME = 'Opening Balances';

const GROUP_TYPE_NAMES = {
  fines_penalties: 'Fines & Penalties',
  tea_balance: 'Chai',
  registration: 'Registration Fees',
  resignation: 'Resignation Fines',
};

function cleanKey(key) {
  return String(key || '').trim().toLowerCase().replace(/\s+/g, '');
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value || '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseAmountOrStatus(value) {
  if (value == null || value === '') return { status: 'blank', amount: 0 };
  if (typeof value === 'number') return { status: 'amount', amount: value };
  const raw = String(value).trim();
  if (!raw) return { status: 'blank', amount: 0 };
  if (/^(nil|paid)$/i.test(raw)) return { status: raw.toLowerCase(), amount: 0 };
  const n = toNumber(raw);
  return n == null ? { status: 'invalid', amount: 0, raw } : { status: 'amount', amount: n };
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, 12));
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return new Date(Date.UTC(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1]), 12));
  const d = new Date(`${raw}T12:00:00Z`);
  return Number.isNaN(d.valueOf()) ? null : d;
}

function normalizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) out[cleanKey(key)] = value;
  return {
    week: toNumber(out.week),
    date: parseDate(out.date),
    rowType: String(out.rowtype || 'member').trim().toLowerCase(),
    name: String(out.name || '').trim(),
    contribution: parseAmountOrStatus(out.contribution),
    chai: out.chai === '' || out.chai == null ? null : toNumber(out.chai),
    debt: out.debt === '' || out.debt == null ? 0 : toNumber(out.debt) || 0,
    extra: out.extra === '' || out.extra == null ? 0 : toNumber(out.extra) || 0,
    previous: out.previous === '' || out.previous == null ? null : toNumber(out.previous),
    total: out.total === '' || out.total == null ? null : toNumber(out.total),
    note: String(out.note || '').trim(),
  };
}

function readRows(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Input file not found: ${filePath}`);
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets.Ledger || workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json(sheet, { defval: '' })
    .map(normalizeRow)
    .filter((r) => r.week && (r.rowType === 'member' ? r.name : true) && (r.contribution.status !== 'blank' || r.debt || r.extra));
}

function validateRows(rows) {
  const errors = [];
  const warnings = [];
  const ignoredWeeks = new Set();

  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    if (row.week < FIRST_INCREMENTAL_WEEK) {
      ignoredWeeks.add(row.week);
      continue;
    }
    if (!row.date) errors.push(`Row ${line} (week ${row.week}): date is required.`);
    if (row.rowType === 'member' && !row.name) errors.push(`Row ${line}: member name is required.`);
    if (row.contribution.status === 'invalid') {
      errors.push(`Row ${line}: contribution "${row.contribution.raw}" is not a number, NIL, or PAID.`);
    }

    const chai = row.chai == null ? CHAI_WEEKLY_AMOUNT : row.chai;
    if (row.rowType === 'member' && row.previous != null && row.total != null) {
      const expected = row.previous + row.contribution.amount + row.extra - chai - row.debt;
      if (expected !== row.total) {
        warnings.push(`Row ${line} (${row.name}, week ${row.week}): expected total ${expected}, sheet says ${row.total} (diff ${row.total - expected}).`);
      }
    }
    if (row.rowType !== 'member' && row.previous != null && row.total != null) {
      const expected = row.previous + row.contribution.amount + row.extra - row.debt;
      if (expected !== row.total) {
        warnings.push(`Row ${line} (${row.name || row.rowType}, week ${row.week}): expected total ${expected}, sheet says ${row.total} (diff ${row.total - expected}).`);
      }
    }
  }

  return { errors, warnings, ignoredWeeks: [...ignoredWeeks].sort((a, b) => a - b) };
}

async function createLogged(Model, doc, entityType, admin) {
  const record = await Model.create(doc);
  await logAudit({ action: 'create', entityType, entityId: record._id, performedBy: admin._id, after: snapshot(record) });
  return record;
}

async function findOrCreateType(name, extra, admin) {
  let type = await ContributionType.findOne({ name });
  if (!type) type = await createLogged(ContributionType, { name, createdBy: admin._id, ...extra }, 'ContributionType', admin);
  return type;
}

// Creates the Contribution only if one with this exact memberId+typeId+note
// doesn't already exist — the re-run safety net.
async function logOnce(admin, { memberId, typeId, amount, date, note }) {
  if (amount <= 0) return 'skipped-zero';
  const existing = await Contribution.findOne({ memberId, typeId, note }).select('_id');
  if (existing) return 'duplicate';
  await createLogged(Contribution, { memberId, typeId, amount, date, method: 'cash', note, loggedBy: admin._id }, 'Contribution', admin);
  return 'created';
}

async function logExpenseOnce(admin, { typeId, amount, date, description }) {
  if (amount <= 0) return 'skipped-zero';
  const existing = await Expense.findOne({ typeId, description }).select('_id');
  if (existing) return 'duplicate';
  await createLogged(Expense, { typeId, amount, date, description, loggedBy: admin._id }, 'Expense', admin);
  return 'created';
}

async function main() {
  const allRows = readRows(INPUT_FILE);
  const { errors, warnings, ignoredWeeks } = validateRows(allRows);
  const rows = allRows.filter((r) => r.week >= FIRST_INCREMENTAL_WEEK);
  const weeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b);

  console.log(`Input: ${INPUT_FILE}`);
  console.log(`Rows with data: ${rows.length} across week(s): ${weeks.join(', ') || '(none)'}`);
  if (ignoredWeeks.length) {
    console.log(`Ignored (already real, before week ${FIRST_INCREMENTAL_WEEK}): week(s) ${ignoredWeeks.join(', ')}`);
  }
  if (warnings.length) {
    console.log('\nWarnings — arithmetic on the row doesn\'t reconcile, worth checking against the photo:');
    warnings.forEach((w) => console.log(`  - ${w}`));
  }
  if (errors.length) {
    console.log('\nErrors:');
    errors.forEach((e) => console.log(`  - ${e}`));
    process.exit(1);
  }
  if (rows.length === 0) {
    console.log('\nNothing to import yet — fill in some weeks first.');
    return;
  }
  if (!CONFIRMED) {
    console.log('\nDRY RUN ONLY. Nothing was written. Re-run with --confirm-import once this looks right.');
    return;
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set.');

  await mongoose.connect(process.env.MONGO_URI);
  const admin = await User.findOne({ role: 'super_admin' });
  if (!admin) throw new Error('No super admin found. Run seedSuperAdmin.js first.');

  const weeklyType = await ContributionType.findOne({ name: 'Weekly Contribution' });
  const chaiType = await ContributionType.findOne({ name: 'Chai' });
  if (!weeklyType || !chaiType) throw new Error('Core contribution types not found — has week 60 been imported?');
  const systemMember = await Member.findOne({ name: SYSTEM_MEMBER_NAME });
  if (!systemMember) throw new Error(`"${SYSTEM_MEMBER_NAME}" system member not found — has week 60 been imported?`);

  const counts = { created: 0, duplicate: 0, 'skipped-zero': 0, warning: 0 };
  const memberRowsByWeek = new Map();
  for (const row of rows) {
    if (row.rowType !== 'member') continue;
    memberRowsByWeek.set(row.week, (memberRowsByWeek.get(row.week) || 0) + 1);
  }

  for (const row of rows) {
    if (row.rowType === 'member') {
      const member = await Member.findOne({ name: row.name });
      if (!member) {
        console.warn(`  ⚠ Week ${row.week}: member not found "${row.name}" — skipped`);
        counts.warning++;
        continue;
      }

      counts[await logOnce(admin, {
        memberId: member._id, typeId: weeklyType._id, amount: row.contribution.amount,
        date: row.date, note: `Week ${row.week} contribution (paper ledger)`,
      })]++;

      const chaiAmount = row.chai == null ? CHAI_WEEKLY_AMOUNT : row.chai;
      counts[await logOnce(admin, {
        memberId: member._id, typeId: chaiType._id, amount: chaiAmount,
        date: row.date, note: `Week ${row.week} Chai (paper ledger)`,
      })]++;

      if (row.extra > 0) {
        const extraType = await findOrCreateType('Extra Contributions', { description: 'Extra member savings from the paper ledger' }, admin);
        counts[await logOnce(admin, {
          memberId: member._id, typeId: extraType._id, amount: row.extra,
          date: row.date, note: `Week ${row.week} extra contribution (paper ledger)`,
        })]++;
      }
      if (row.debt > 0) {
        console.warn(`  ⚠ Week ${row.week}: ${row.name} has a debt of ${row.debt} on their row — Expense records aren't per-member, log this manually if it's real`);
        counts.warning++;
      }
      continue;
    }

    const typeName = GROUP_TYPE_NAMES[row.rowType];
    if (!typeName) continue;
    const type = await ContributionType.findOne({ name: typeName });
    if (!type) {
      console.warn(`  ⚠ Week ${row.week}: contribution type "${typeName}" not found — skipped`);
      counts.warning++;
      continue;
    }

    if (row.rowType === 'tea_balance') {
      const memberCount = memberRowsByWeek.get(row.week) || 0;
      const total = row.contribution.amount + memberCount * CHAI_WEEKLY_AMOUNT;
      counts[await logOnce(admin, {
        memberId: systemMember._id, typeId: type._id, amount: total, date: row.date,
        note: `Week ${row.week} tea: ${row.contribution.amount} collected + ${memberCount * CHAI_WEEKLY_AMOUNT} chai from members`,
      })]++;
    } else if (row.contribution.amount > 0) {
      counts[await logOnce(admin, {
        memberId: systemMember._id, typeId: type._id, amount: row.contribution.amount,
        date: row.date, note: `Week ${row.week} ${row.name || row.rowType} collected`,
      })]++;
    }

    if (row.debt > 0) {
      counts[await logExpenseOnce(admin, {
        typeId: type._id, amount: row.debt, date: row.date,
        description: `Week ${row.week} ${row.name || row.rowType} debt/expense from paper ledger`,
      })]++;
    }
  }

  console.log('\nImport complete.');
  console.log(`Created: ${counts.created}  Already imported (skipped): ${counts.duplicate}  Zero-amount (skipped): ${counts['skipped-zero']}  Warnings: ${counts.warning}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
