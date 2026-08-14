require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');

const User = require('../models/User');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const Fine = require('../models/Fine');
const FineType = require('../models/FineType');
const Pledge = require('../models/Pledge');
const Expense = require('../models/Expense');
const AuditLog = require('../models/AuditLog');
const { logAudit, snapshot } = require('../utils/auditLogger');

const DEFAULT_FILE = path.resolve(__dirname, '../../data/ledger_weeks_61_86_template.xlsx');
const CONFIRMED = process.argv.includes('--confirm-wipe');
const fileArg = process.argv.find((arg) => arg.startsWith('--file='));
const INPUT_FILE = path.resolve(fileArg ? fileArg.slice('--file='.length) : DEFAULT_FILE);

const WEEKLY_CONTRIBUTION_AMOUNT = 1400;
const CHAI_WEEKLY_AMOUNT = 100;
const START_WEEK = 61;
const END_WEEK = 86;

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

function emptyToZero(value) {
  const n = toNumber(value);
  return n == null ? 0 : n;
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
    debt: emptyToZero(out.debt),
    extra: emptyToZero(out.extra),
    previous: out.previous === '' || out.previous == null ? null : toNumber(out.previous),
    total: out.total === '' || out.total == null ? null : toNumber(out.total),
    note: String(out.note || '').trim(),
  };
}

function readRows(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Input file not found: ${filePath}`);
  if (path.extname(filePath).toLowerCase() === '.csv') {
    return parse(fs.readFileSync(filePath, 'utf8'), {
      columns: true,
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }).map(normalizeRow);
  }

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets.Ledger || workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' }).map(normalizeRow);
}

function validateRows(rows) {
  const errors = [];
  const warnings = [];
  const memberNames = new Set();
  const firstByMember = new Map();

  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    if (!row.week || row.week < START_WEEK || row.week > END_WEEK) errors.push(`Row ${line}: week must be ${START_WEEK}-${END_WEEK}.`);
    if (!row.date) errors.push(`Row ${line}: date is required.`);
    if (row.rowType === 'member' && !row.name) errors.push(`Row ${line}: member name is required.`);
    if (row.contribution.status === 'invalid') errors.push(`Row ${line}: contribution "${row.contribution.raw}" is not a number, NIL, or PAID.`);

    if (row.rowType === 'member' && row.name) {
      memberNames.add(row.name);
      if (!firstByMember.has(row.name) || row.week < firstByMember.get(row.name).week) firstByMember.set(row.name, row);
      const chai = row.chai == null ? CHAI_WEEKLY_AMOUNT : row.chai;
      if (row.previous != null && row.total != null) {
        const expected = row.previous + row.contribution.amount + row.extra - chai - row.debt;
        if (expected !== row.total) {
          warnings.push(`Row ${line} (${row.name}, week ${row.week}): expected ${expected}, sheet says ${row.total}, diff ${row.total - expected}.`);
        }
      }
    }

    if (row.rowType !== 'member' && row.previous != null && row.total != null) {
      const expected = row.previous + row.contribution.amount + row.extra - row.debt;
      if (expected !== row.total) {
        warnings.push(`Row ${line} (${row.name || row.rowType}, week ${row.week}): expected ${expected}, sheet says ${row.total}, diff ${row.total - expected}.`);
      }
    }
  }

  for (const [name, row] of firstByMember.entries()) {
    if (row.previous == null) errors.push(`${name}: first visible week must have previous filled for opening balance.`);
  }

  return { errors, warnings, memberCount: memberNames.size };
}

function dayBefore(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function placeholderPhone(index) {
  return `07${String(index).padStart(8, '0')}`;
}

async function createLogged(Model, doc, entityType, admin) {
  const record = await Model.create(doc);
  await logAudit({
    action: 'create',
    entityType,
    entityId: record._id,
    performedBy: admin._id,
    after: snapshot(record),
  });
  return record;
}

async function createTypes(admin) {
  const weeklyType = await createLogged(ContributionType, {
    name: 'Weekly Contribution',
    description: 'Mandatory weekly contribution',
    isWeekly: true,
    weeklyAmount: WEEKLY_CONTRIBUTION_AMOUNT,
    createdBy: admin._id,
  }, 'ContributionType', admin);
  const chaiType = await createLogged(ContributionType, {
    name: 'Chai',
    description: 'Weekly Chai/refreshments contribution',
    isWeekly: true,
    weeklyAmount: CHAI_WEEKLY_AMOUNT,
    tracksExpenses: true,
    isGroupFund: true,
    createdBy: admin._id,
  }, 'ContributionType', admin);
  const extraType = await createLogged(ContributionType, {
    name: 'Extra Contributions',
    description: 'Extra member savings from the paper ledger',
    createdBy: admin._id,
  }, 'ContributionType', admin);
  const finesType = await createLogged(ContributionType, {
    name: 'Fines & Penalties',
    description: 'Fines and penalties collected',
    isGroupFund: true,
    createdBy: admin._id,
  }, 'ContributionType', admin);
  const registrationType = await createLogged(ContributionType, {
    name: 'Registration Fees',
    description: 'Registration fees collected',
    isGroupFund: true,
    createdBy: admin._id,
  }, 'ContributionType', admin);
  const resignationType = await createLogged(ContributionType, {
    name: 'Resignation Fines',
    description: 'Resignation fines collected',
    isGroupFund: true,
    createdBy: admin._id,
  }, 'ContributionType', admin);

  return { weeklyType, chaiType, extraType, finesType, registrationType, resignationType };
}

async function main() {
  const rows = readRows(INPUT_FILE).filter((row) => row.week || row.name || row.rowType);
  const { errors, warnings, memberCount } = validateRows(rows);

  console.log(`Input: ${INPUT_FILE}`);
  console.log(`Rows found: ${rows.length}`);
  console.log(`Members found: ${memberCount}`);
  if (warnings.length) {
    console.log('\nWarnings to check against the book:');
    warnings.forEach((warning) => console.log(`  - ${warning}`));
  }
  if (errors.length) {
    console.log('\nErrors:');
    errors.forEach((error) => console.log(`  - ${error}`));
    process.exit(1);
  }
  if (!CONFIRMED) {
    console.log('\nDRY RUN ONLY. Nothing was written.');
    console.log('Re-run with --confirm-wipe after the spreadsheet is correct.');
    return;
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set.');

  await mongoose.connect(process.env.MONGO_URI);
  const admin = await User.findOne({ role: 'super_admin' });
  if (!admin) throw new Error('No super admin found. Run seedSuperAdmin.js first.');

  await Promise.all([
    Member.deleteMany({}),
    Contribution.deleteMany({}),
    Fine.deleteMany({}),
    FineType.deleteMany({}),
    ContributionType.deleteMany({}),
    Pledge.deleteMany({}),
    Expense.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);

  const types = await createTypes(admin);
  const firstDate = rows.reduce((min, row) => (row.date && (!min || row.date < min) ? row.date : min), null);
  const openingDate = dayBefore(firstDate);
  const memberRows = rows.filter((row) => row.rowType === 'member');
  const memberNames = [...new Set(memberRows.map((row) => row.name))];
  const memberMap = new Map();

  for (const [index, name] of memberNames.entries()) {
    const firstRow = memberRows.filter((row) => row.name === name).sort((a, b) => a.week - b.week)[0];
    const member = await createLogged(Member, {
      name,
      phone: placeholderPhone(index + 1),
      regNumber: `CM-${String(index + 1).padStart(4, '0')}`,
      notes: 'Phone number is a placeholder - replace with the real number once collected.',
      joinDate: firstDate,
      createdBy: admin._id,
    }, 'Member', admin);
    memberMap.set(name, member);
    await createLogged(Contribution, {
      memberId: member._id,
      typeId: types.weeklyType._id,
      amount: firstRow.previous,
      date: openingDate,
      method: 'other',
      note: `Opening balance imported from paper ledger before week ${firstRow.week}`,
      loggedBy: admin._id,
    }, 'Contribution', admin);
  }

  const systemMember = await createLogged(Member, {
    name: 'Opening Balances (Paper Ledger)',
    phone: '0700000000',
    regNumber: 'SYS-0000',
    notes: 'System row for chama-wide balances from the paper ledger.',
    active: false,
    createdBy: admin._id,
  }, 'Member', admin);

  const groupTypeByRow = {
    fines_penalties: types.finesType,
    tea_balance: types.chaiType,
    registration: types.registrationType,
    resignation: types.resignationType,
  };
  const openedGroupRows = new Set();
  let contributionCount = memberNames.length;
  let expenseCount = 0;

  for (const row of rows.sort((a, b) => a.week - b.week || dateKey(a.date).localeCompare(dateKey(b.date)))) {
    if (row.rowType === 'member') {
      const member = memberMap.get(row.name);
      if (row.contribution.amount > 0) {
        await createLogged(Contribution, {
          memberId: member._id,
          typeId: types.weeklyType._id,
          amount: row.contribution.amount,
          date: row.date,
          method: 'cash',
          note: row.note || `Week ${row.week} contribution imported from paper ledger`,
          loggedBy: admin._id,
        }, 'Contribution', admin);
        contributionCount++;
      }
      if (row.extra > 0) {
        await createLogged(Contribution, {
          memberId: member._id,
          typeId: types.extraType._id,
          amount: row.extra,
          date: row.date,
          method: 'cash',
          note: row.note || `Week ${row.week} extra contribution imported from paper ledger`,
          loggedBy: admin._id,
        }, 'Contribution', admin);
        contributionCount++;
      }
      const chai = row.chai == null ? CHAI_WEEKLY_AMOUNT : row.chai;
      if (chai > 0) {
        await createLogged(Contribution, {
          memberId: member._id,
          typeId: types.chaiType._id,
          amount: chai,
          date: row.date,
          method: 'cash',
          note: `Week ${row.week} Chai imported from paper ledger`,
          loggedBy: admin._id,
        }, 'Contribution', admin);
        contributionCount++;
      }
      continue;
    }

    const type = groupTypeByRow[row.rowType];
    if (!type) continue;
    if (!openedGroupRows.has(row.rowType) && row.previous > 0) {
      await createLogged(Contribution, {
        memberId: systemMember._id,
        typeId: type._id,
        amount: row.previous,
        date: openingDate,
        method: 'other',
        note: `Opening ${row.name || row.rowType} balance before week ${row.week}`,
        loggedBy: admin._id,
      }, 'Contribution', admin);
      openedGroupRows.add(row.rowType);
      contributionCount++;
    }
    if (row.contribution.amount + row.extra > 0) {
      await createLogged(Contribution, {
        memberId: systemMember._id,
        typeId: type._id,
        amount: row.contribution.amount + row.extra,
        date: row.date,
        method: 'cash',
        note: row.note || `Week ${row.week} ${row.name || row.rowType} imported from paper ledger`,
        loggedBy: admin._id,
      }, 'Contribution', admin);
      contributionCount++;
    }
    if (row.debt > 0) {
      await createLogged(Expense, {
        typeId: type._id,
        amount: row.debt,
        date: row.date,
        description: row.note || `Week ${row.week} ${row.name || row.rowType} debt/expense from paper ledger`,
        loggedBy: admin._id,
      }, 'Expense', admin);
      expenseCount++;
    }
  }

  console.log('\nImport complete.');
  console.log(`Members created: ${memberNames.length} + 1 system member`);
  console.log(`Contributions logged: ${contributionCount}`);
  console.log(`Expenses logged: ${expenseCount}`);
  console.log('Placeholder phone numbers were used; replace them in the admin UI.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
