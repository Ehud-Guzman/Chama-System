/**
 * Incremental Chama Ledger Importer
 *
 * PURPOSE
 * -------
 * Imports historical ledger data from an Excel/CSV file into the LIVE database
 * without wiping existing data.
 *
 * Usage:
 *
 *   Dry run:
 *   node src/scripts/importLedgerIncremental.js
 *
 *   Dry run with specific file:
 *   node src/scripts/importLedgerIncremental.js --file="C:\path\ledger.xlsx"
 *
 *   Import:
 *   node src/scripts/importLedgerIncremental.js --confirm-import
 *
 *   Import specific file:
 *   node src/scripts/importLedgerIncremental.js --confirm-import --file="C:\path\ledger.xlsx"
 *
 *
 * ACCOUNTING RULES
 * ----------------
 *
 * MEMBER TOTAL:
 *
 *   Previous
 *   + Weekly Contribution
 *   + Extra
 *   - Chai
 *   = Current Member Total
 *
 * Welfare/debt is NOT deducted from the current member total.
 * It is logged as a liability and, when the next week's row exists,
 * a negative welfare contribution is created in the following week.
 *
 * The "fines" column is likewise NOT deducted from the current member
 * total — it's logged as a standalone Fine record, same as the existing
 * auto-generated NIL/threshold fine below.
 *
 *
 * GROUP EXPENSES:
 *
 *   Land Purchase
 *   Dowry
 *   Incentives
 *   Transport
 *   Equipment
 *   etc.
 *
 * are GROUP expenses.
 *
 * They must NEVER be attached to a member's personal balance.
 *
 * Excel format:
 *
 *   rowType        = expense
 *   name           = Land Purchase
 *   expense_type   = Land Purchase
 *   expense_amount = 2590000
 *
 * Legacy embedded expenses on member rows are also detected and logged
 * as group expenses, so they are not lost if any old rows remain.
 */

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
const Expense = require('../models/Expense');

const {
  logAudit,
  snapshot,
} = require('../utils/auditLogger');


// ============================================================
// CONFIGURATION
// ============================================================

const CONFIRMED = process.argv.includes('--confirm-import');

const fileArg = process.argv.find(
  (arg) => arg.startsWith('--file=')
);

const DEFAULT_FILE = path.resolve(
  __dirname,
  '../../data/ledger_weeks_62_84_template.xlsx'
);

const INPUT_FILE = path.resolve(
  fileArg
    ? fileArg.slice('--file='.length)
    : DEFAULT_FILE
);


// Week 60 and 61 already exist in the live database.
// Do not import them again.
const FIRST_INCREMENTAL_WEEK = 62;

const CHAI_WEEKLY_AMOUNT = 100;

const SYSTEM_MEMBER_NAME = 'Opening Balances';

const GROUP_EXPENSE_TYPE_NAME = 'Group Expenses';


// Legacy group row mappings.
const GROUP_TYPE_NAMES = {
  fines_penalties: 'Fines & Penalties',
  tea_balance: 'Chai',
  registration: 'Registration Fees',
  resignation: 'Resignation Fines',
};


// ============================================================
// BASIC HELPERS
// ============================================================

function cleanKey(key) {
  return String(key || '')
    .trim()
    .toLowerCase()
    // FIXED: was `.replace(/\s+/g, '')` — only stripped whitespace, so a
    // header like "expense_type" normalized to "expense_type" (underscore
    // intact) while normalizeRow() below reads `out.expensetype` (no
    // underscore). That mismatch meant expense_type/expense_amount were
    // always undefined, and rowHasData() silently dropped every expense row.
    .replace(/[\s_]+/g, '');
}


function toNumber(value) {
  if (typeof value === 'number') {
    return value;
  }

  const cleaned = String(value || '')
    .replace(/,/g, '')
    .trim();

  if (!cleaned) {
    return null;
  }

  const number = Number(cleaned);

  return Number.isFinite(number)
    ? number
    : null;
}


function emptyToZero(value) {
  const number = toNumber(value);

  return number == null
    ? 0
    : number;
}


// ============================================================
// CONTRIBUTION PARSER
// ============================================================

function parseAmountOrStatus(value) {
  if (value == null || value === '') {
    return {
      status: 'blank',
      amount: 0,
    };
  }

  if (typeof value === 'number') {
    return {
      status: 'amount',
      amount: value,
    };
  }

  const raw = String(value).trim();

  if (!raw) {
    return {
      status: 'blank',
      amount: 0,
    };
  }

  if (/^(nil|paid)$/i.test(raw)) {
    return {
      status: raw.toLowerCase(),
      amount: 0,
    };
  }

  const number = toNumber(raw);

  if (number == null) {
    return {
      status: 'invalid',
      amount: 0,
      raw,
    };
  }

  return {
    status: 'amount',
    amount: number,
  };
}


// ============================================================
// DATE PARSER
// ============================================================

function parseDate(value) {
  if (
    value instanceof Date &&
    !Number.isNaN(value.valueOf())
  ) {
    return value;
  }

  // Excel serial date.
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (parsed) {
      return new Date(
        Date.UTC(
          parsed.y,
          parsed.m - 1,
          parsed.d,
          12
        )
      );
    }
  }

  const raw = String(value || '').trim();

  if (!raw) {
    return null;
  }

  // dd/mm/yyyy
  const slash = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  );

  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]);

    /*
     * The Excel workbook is expected to give us real Date objects.
     * For string input we first interpret it as dd/mm/yyyy.
     */
    const day = first;
    const month = second;

    const date = new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        12
      )
    );

    if (!Number.isNaN(date.valueOf())) {
      return date;
    }
  }

  const parsed = new Date(`${raw}T12:00:00Z`);

  return Number.isNaN(parsed.valueOf())
    ? null
    : parsed;
}


// ============================================================
// ROW NORMALIZATION
// ============================================================

function normalizeRow(row) {
  const out = {};

  for (const [key, value] of Object.entries(row)) {
    out[cleanKey(key)] = value;
  }

  return {
    week: toNumber(out.week),

    date: parseDate(out.date),

    rowType: String(
      out.rowtype || 'member'
    )
      .trim()
      .toLowerCase(),

    name: String(
      out.name || ''
    ).trim(),

    contribution:
      parseAmountOrStatus(
        out.contribution
      ),

    chai:
      out.chai === '' ||
      out.chai == null
        ? null
        : toNumber(out.chai),

    // NEW: the "fines" column existed in the sheet but was never read
    // into the row object at all, so it was silently ignored end-to-end.
    fines: emptyToZero(out.fines),

    debt:
      out.debt === '' ||
      out.debt == null
        ? 0
        : toNumber(out.debt) || 0,

    extra:
      out.extra === '' ||
      out.extra == null
        ? 0
        : toNumber(out.extra) || 0,

    previous:
      out.previous === '' ||
      out.previous == null
        ? null
        : toNumber(out.previous),

    total:
      out.total === '' ||
      out.total == null
        ? null
        : toNumber(out.total),

    threshold:
      out.threshold === '' ||
      out.threshold == null
        ? null
        : toNumber(out.threshold),

    // Generic group expense fields.
    expenseType: String(
      out.expensetype || ''
    ).trim(),

    expenseAmount:
      out.expenseamount === '' ||
      out.expenseamount == null
        ? 0
        : toNumber(out.expenseamount) || 0,

    note: String(
      out.note || ''
    ).trim(),
  };
}


// ============================================================
// READ XLSX / CSV
// ============================================================

function readRows(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Input file not found: ${filePath}`
    );
  }

  // CSV support.
  if (
    path.extname(filePath).toLowerCase() === '.csv'
  ) {
    const parsed = parse(
      fs.readFileSync(
        filePath,
        'utf8'
      ),
      {
        columns: true,
        bom: true,
        trim: true,
        skip_empty_lines: true,
        relax_column_count: true,
      }
    );

    return parsed
      .map(normalizeRow)
      .filter(rowHasData);
  }

  // XLSX support.
  const workbook = XLSX.readFile(
    filePath,
    {
      cellDates: true,
    }
  );

  const sheet =
    workbook.Sheets.Ledger ||
    workbook.Sheets[
      workbook.SheetNames[0]
    ];

  if (!sheet) {
    throw new Error(
      'No Ledger sheet found in workbook.'
    );
  }

  return XLSX.utils
    .sheet_to_json(
      sheet,
      {
        defval: '',
      }
    )
    .map(normalizeRow)
    .filter(rowHasData);
}


function rowHasData(row) {
  if (!row.week) {
    return false;
  }

  if (
    row.rowType === 'member' &&
    !row.name
  ) {
    return false;
  }

  return (
    row.contribution.status !== 'blank' ||
    row.debt > 0 ||
    row.extra > 0 ||
    row.fines > 0 ||
    row.expenseAmount > 0 ||
    row.expenseType !== '' ||
    row.previous != null ||
    row.total != null
  );
}


// ============================================================
// VALIDATION
// ============================================================

function validateRows(rows) {
  const errors = [];
  const warnings = [];
  const ignoredWeeks = new Set();

  for (
    const [index, row]
    of rows.entries()
  ) {
    const line = index + 2;

    // Ignore already imported weeks.
    if (
      row.week <
      FIRST_INCREMENTAL_WEEK
    ) {
      ignoredWeeks.add(row.week);
      continue;
    }

    if (!row.date) {
      errors.push(
        `Row ${line} (week ${row.week}): date is required.`
      );
    }

    if (
      row.rowType === 'member' &&
      !row.name
    ) {
      errors.push(
        `Row ${line}: member name is required.`
      );
    }

    if (
      row.contribution.status ===
      'invalid'
    ) {
      errors.push(
        `Row ${line}: contribution "${row.contribution.raw}" is not a number, NIL, or PAID.`
      );
    }


    // --------------------------------------------------------
    // MEMBER TOTAL
    //
    // Previous + Contribution + Extra - Chai
    //
    // Debt/welfare and fines are NOT deducted here.
    // --------------------------------------------------------

    if (
      row.rowType === 'member' &&
      row.previous != null &&
      row.total != null
    ) {
      const chai =
        row.chai == null
          ? CHAI_WEEKLY_AMOUNT
          : row.chai;

      const expected =
        row.previous +
        row.contribution.amount +
        row.extra -
        chai;

      if (
        expected !== row.total
      ) {
        warnings.push(
          `Row ${line} (${row.name}, week ${row.week}): expected total ${expected}, sheet says ${row.total}, diff ${row.total - expected}.`
        );
      }
    }


    // --------------------------------------------------------
    // GROUP EXPENSE ROW
    // --------------------------------------------------------

    if (
      row.rowType === 'expense'
    ) {
      const description =
        row.expenseType ||
        row.name ||
        '';

      if (!description) {
        errors.push(
          `Row ${line} (week ${row.week}): expense row needs a name or expense_type.`
        );
      }

      if (
        row.expenseAmount <= 0
      ) {
        errors.push(
          `Row ${line} (week ${row.week}): expense_amount must be greater than zero.`
        );
      }

      // Only validate arithmetic if
      // previous and total were deliberately supplied.
      if (
        row.previous != null &&
        row.total != null
      ) {
        const expected =
          row.previous +
          row.contribution.amount +
          row.extra -
          row.expenseAmount;

        if (
          expected !== row.total
        ) {
          warnings.push(
            `Row ${line} (${description}, week ${row.week}): expected group total ${expected}, sheet says ${row.total}, diff ${row.total - expected}.`
          );
        }
      }
    }


    // --------------------------------------------------------
    // LEGACY GROUP ROWS
    // --------------------------------------------------------

    if (
      row.rowType !== 'member' &&
      row.rowType !== 'expense' &&
      row.previous != null &&
      row.total != null
    ) {
      const expected =
        row.previous +
        row.contribution.amount +
        row.extra -
        row.debt;

      if (
        expected !== row.total
      ) {
        warnings.push(
          `Row ${line} (${row.name || row.rowType}, week ${row.week}): expected total ${expected}, sheet says ${row.total}, diff ${row.total - expected}.`
        );
      }
    }
  }

  return {
    errors,
    warnings,
    ignoredWeeks:
      [...ignoredWeeks].sort(
        (a, b) => a - b
      ),
  };
}


// ============================================================
// AUDITED CREATE
// ============================================================

async function createLogged(
  Model,
  document,
  entityType,
  admin
) {
  const record =
    await Model.create(
      document
    );

  await logAudit({
    action: 'create',
    entityType,
    entityId: record._id,
    performedBy: admin._id,
    after: snapshot(record),
  });

  return record;
}


// ============================================================
// FIND OR CREATE CONTRIBUTION TYPE
// ============================================================

async function findOrCreateType(
  name,
  extra,
  admin
) {
  let type =
    await ContributionType.findOne({
      name,
    });

  if (!type) {
    type = await createLogged(
      ContributionType,
      {
        name,
        createdBy: admin._id,
        ...extra,
      },
      'ContributionType',
      admin
    );
  }

  return type;
}


// ============================================================
// DUPLICATE-SAFE CONTRIBUTION
// ============================================================

async function logContributionOnce(
  admin,
  {
    memberId,
    typeId,
    amount,
    date,
    note,
  }
) {
  if (amount <= 0) {
    return 'skipped-zero';
  }

  const existing =
    await Contribution.findOne({
      memberId,
      typeId,
      note,
    }).select('_id');

  if (existing) {
    return 'duplicate';
  }

  await createLogged(
    Contribution,
    {
      memberId,
      typeId,
      amount,
      date,
      method: 'cash',
      note,
      loggedBy: admin._id,
    },
    'Contribution',
    admin
  );

  return 'created';
}


// ============================================================
// DUPLICATE-SAFE EXPENSE
// ============================================================

async function logExpenseOnce(
  admin,
  {
    typeId,
    amount,
    date,
    description,
  }
) {
  if (amount <= 0) {
    return 'skipped-zero';
  }

  /*
   * Use all identifying fields so the same description can
   * legally exist in different weeks/dates without being
   * treated as the same transaction.
   */
  const existing =
    await Expense.findOne({
      typeId,
      amount,
      date,
      description,
    }).select('_id');

  if (existing) {
    return 'duplicate';
  }

  await createLogged(
    Expense,
    {
      typeId,
      amount,
      date,
      description,
      loggedBy: admin._id,
    },
    'Expense',
    admin
  );

  return 'created';
}


// ============================================================
// DUPLICATE-SAFE FINE
// ============================================================

async function logFineOnce(
  admin,
  {
    memberId,
    amount,
    date,
    reason,
  }
) {
  if (amount <= 0) {
    return 'skipped-zero';
  }

  const existing =
    await Fine.findOne({
      memberId,
      date,
      reason,
    }).select('_id');

  if (existing) {
    return 'duplicate';
  }

  await createLogged(
    Fine,
    {
      memberId,
      amount,
      remaining: amount,
      date,
      reason,
      issuedBy: admin._id,
    },
    'Fine',
    admin
  );

  return 'created';
}


// ============================================================
// MAIN
// ============================================================

async function main() {
  const allRows =
    readRows(INPUT_FILE);

  const {
    errors,
    warnings,
    ignoredWeeks,
  } =
    validateRows(allRows);

  const rows =
    allRows.filter(
      (row) =>
        row.week >=
        FIRST_INCREMENTAL_WEEK
    );

  const weeks =
    [
      ...new Set(
        rows.map(
          (row) => row.week
        )
      ),
    ].sort(
      (a, b) => a - b
    );


  // ----------------------------------------------------------
  // DRY-RUN SUMMARY
  // ----------------------------------------------------------

  console.log(
    `Input: ${INPUT_FILE}`
  );

  console.log(
    `Rows with data: ${rows.length} across week(s): ${
      weeks.join(', ') || '(none)'
    }`
  );

  if (ignoredWeeks.length) {
    console.log(
      `Ignored (already imported before week ${FIRST_INCREMENTAL_WEEK}): ${ignoredWeeks.join(', ')}`
    );
  }


  // Count expense rows for visibility.
  const expenseRows =
    rows.filter(
      (row) =>
        row.rowType === 'expense'
    );

  if (expenseRows.length) {
    console.log(
      `Group expense rows detected: ${expenseRows.length}`
    );

    for (
      const expense
      of expenseRows
    ) {
      console.log(
        `  - Week ${expense.week}: ${
          expense.expenseType ||
          expense.name ||
          'Unnamed expense'
        } = ${expense.expenseAmount}`
      );
    }
  }


  // Count manual "fines" column entries for visibility.
  const finesRows =
    rows.filter(
      (row) =>
        row.rowType === 'member' &&
        row.fines > 0
    );

  if (finesRows.length) {
    console.log(
      `Manual fine values detected in 'fines' column: ${finesRows.length}`
    );
  }


  // Detect older embedded expenses
  // on member rows.
  const embeddedExpenses =
    rows.filter(
      (row) =>
        row.rowType === 'member' &&
        (
          row.expenseAmount > 0 ||
          row.expenseType !== ''
        )
    );

  if (
    embeddedExpenses.length
  ) {
    console.log(
      `Embedded member-row expenses detected: ${embeddedExpenses.length}`
    );

    for (
      const expense
      of embeddedExpenses
    ) {
      console.log(
        `  - Week ${expense.week}: ${
          expense.expenseType ||
          'Unnamed expense'
        } = ${expense.expenseAmount} (original row: ${expense.name})`
      );
    }
  }


  if (warnings.length) {
    console.log(
      '\nWarnings — historical arithmetic does not reconcile:'
    );

    warnings.forEach(
      (warning) =>
        console.log(
          `  - ${warning}`
        )
    );
  }


  if (errors.length) {
    console.log(
      '\nErrors:'
    );

    errors.forEach(
      (error) =>
        console.log(
          `  - ${error}`
        )
    );

    process.exit(1);
  }


  if (rows.length === 0) {
    console.log(
      '\nNothing to import yet.'
    );

    return;
  }


  // ----------------------------------------------------------
  // DRY RUN STOP
  // ----------------------------------------------------------

  if (!CONFIRMED) {
    console.log(
      '\nDRY RUN ONLY. Nothing was written.'
    );

    console.log(
      'Re-run with --confirm-import once the output looks correct.'
    );

    return;
  }


  // ----------------------------------------------------------
  // DATABASE
  // ----------------------------------------------------------

  if (!process.env.MONGO_URI) {
    throw new Error(
      'MONGO_URI is not set.'
    );
  }

  await mongoose.connect(
    process.env.MONGO_URI
  );

  const admin =
    await User.findOne({
      role: 'super_admin',
    });

  if (!admin) {
    throw new Error(
      'No super admin found. Run seedSuperAdmin.js first.'
    );
  }


  // ----------------------------------------------------------
  // EXISTING CORE TYPES
  // ----------------------------------------------------------

  const weeklyType =
    await ContributionType.findOne({
      name:
        'Weekly Contribution',
    });

  const chaiType =
    await ContributionType.findOne({
      name: 'Chai',
    });

  if (
    !weeklyType ||
    !chaiType
  ) {
    throw new Error(
      'Core contribution types not found. Week 60/61 setup may not have been completed.'
    );
  }


  // ----------------------------------------------------------
  // SYSTEM MEMBER
  // ----------------------------------------------------------

  const systemMember =
    await Member.findOne({
      name:
        SYSTEM_MEMBER_NAME,
    });

  if (!systemMember) {
    throw new Error(
      `"${SYSTEM_MEMBER_NAME}" system member not found.`
    );
  }


  // ----------------------------------------------------------
  // GROUP EXPENSE TYPE
  // ----------------------------------------------------------

  let groupExpenseType = null;

  const needsGenericExpenseType =
    rows.some(
      (row) =>
        row.rowType === 'expense' ||
        (
          row.rowType === 'member' &&
          row.expenseAmount > 0
        ) ||
        (
          row.rowType === 'member' &&
          row.expenseType !== ''
        )
    );

  if (
    needsGenericExpenseType
  ) {
    groupExpenseType =
      await findOrCreateType(
        GROUP_EXPENSE_TYPE_NAME,
        {
          description:
            'General group-level expenses imported from the paper ledger',
          isGroupFund: true,
          tracksExpenses: true,
        },
        admin
      );
  }


  // ----------------------------------------------------------
  // COUNTERS
  // ----------------------------------------------------------

  const counts = {
    created: 0,
    duplicate: 0,
    'skipped-zero': 0,
    warning: 0,
  };


  // ----------------------------------------------------------
  // MEMBER COUNT PER WEEK
  //
  // Used to calculate Tea Balance.
  // ----------------------------------------------------------

  const memberRowsByWeek =
    new Map();

  for (
    const row of rows
  ) {
    if (
      row.rowType !== 'member'
    ) {
      continue;
    }

    memberRowsByWeek.set(
      row.week,
      (
        memberRowsByWeek.get(
          row.week
        ) || 0
      ) + 1
    );
  }


  // ----------------------------------------------------------
  // IMPORT ROWS
  // ----------------------------------------------------------

  const sortedRows =
    [...rows].sort(
      (a, b) => {
        if (
          a.week !== b.week
        ) {
          return a.week - b.week;
        }

        const dateA =
          a.date
            ? a.date.getTime()
            : 0;

        const dateB =
          b.date
            ? b.date.getTime()
            : 0;

        return dateA - dateB;
      }
    );


  for (
    const row
    of sortedRows
  ) {


    // ========================================================
    // GROUP EXPENSE ROW
    // ========================================================

    if (
      row.rowType === 'expense'
    ) {
      if (
        row.expenseAmount <= 0
      ) {
        console.warn(
          `  ⚠ Week ${row.week}: expense "${row.expenseType || row.name || 'unnamed'}" has no positive amount — skipped.`
        );

        counts.warning++;

        continue;
      }

      const description =
        row.expenseType ||
        row.name ||
        `Week ${row.week} group expense`;

      counts[
        await logExpenseOnce(
          admin,
          {
            typeId:
              groupExpenseType._id,

            amount:
              row.expenseAmount,

            date:
              row.date,

            description:
              `Week ${row.week} ${description}${
                row.note
                  ? ` - ${row.note}`
                  : ''
              }`,
          }
        )
      ]++;

      continue;
    }


    // ========================================================
    // MEMBER ROW
    // ========================================================

    if (
      row.rowType === 'member'
    ) {
      const member =
        await Member.findOne({
          name: row.name,
        });

      if (!member) {
        console.warn(
          `  ⚠ Week ${row.week}: member not found "${row.name}" — skipped.`
        );

        counts.warning++;

        continue;
      }


      // ------------------------------------------------------
      // WEEKLY CONTRIBUTION
      // ------------------------------------------------------

      counts[
        await logContributionOnce(
          admin,
          {
            memberId:
              member._id,

            typeId:
              weeklyType._id,

            amount:
              row.contribution.amount,

            date:
              row.date,

            note:
              `Week ${row.week} contribution (paper ledger)`,
          }
        )
      ]++;


      // ------------------------------------------------------
      // EXTRA CONTRIBUTION
      // ------------------------------------------------------

      if (row.extra > 0) {
        const extraType =
          await findOrCreateType(
            'Extra Contributions',
            {
              description:
                'Extra member savings from the paper ledger',
            },
            admin
          );

        counts[
          await logContributionOnce(
            admin,
            {
              memberId:
                member._id,

              typeId:
                extraType._id,

              amount:
                row.extra,

              date:
                row.date,

              note:
                `Week ${row.week} extra contribution (paper ledger)`,
            }
          )
        ]++;
      }


      // ------------------------------------------------------
      // WELFARE / DEBT LIABILITY
      //
      // This does NOT reduce the current member balance.
      // ------------------------------------------------------

      if (row.debt > 0) {
        const welfareType =
          await findOrCreateType(
            'Welfare Contribution',
            {
              description:
                'Welfare/liability contribution carried forward to the following week',
            },
            admin
          );

        counts[
          await logContributionOnce(
            admin,
            {
              memberId:
                member._id,

              typeId:
                welfareType._id,

              amount:
                row.debt,

              date:
                row.date,

              note:
                `Week ${row.week} welfare liability (paper ledger)`,
            }
          )
        ]++;
      }


      // ------------------------------------------------------
      // CHAI
      // ------------------------------------------------------

      const chaiAmount =
        row.chai == null
          ? CHAI_WEEKLY_AMOUNT
          : row.chai;

      if (
        chaiAmount > 0
      ) {
        counts[
          await logContributionOnce(
            admin,
            {
              memberId:
                member._id,

              typeId:
                chaiType._id,

              amount:
                chaiAmount,

              date:
                row.date,

              note:
                `Week ${row.week} Chai (paper ledger)`,
            }
          )
        ]++;
      }


      // ------------------------------------------------------
      // MANUAL FINE (from the ledger's "fines" column)
      //
      // NEW — this column was present in the sheet but never read
      // anywhere in the original script, so these values were
      // silently dropped. Logged here as a standalone Fine record,
      // separate from the auto NIL/threshold fine below.
      //
      // ASSUMPTION TO CONFIRM: this treats each "fines" value as a
      // manual fine issued that week, not deducted from the running
      // total (same treatment as welfare/debt). If it's meant to mean
      // something else, tell me before running --confirm-import.
      // ------------------------------------------------------

      if (row.fines > 0) {
        counts[
          await logFineOnce(
            admin,
            {
              memberId:
                member._id,

              amount:
                row.fines,

              date:
                row.date,

              reason:
                `Week ${row.week} - manual fine (paper ledger)`,
            }
          )
        ]++;
      }


      // ------------------------------------------------------
      // NIL FINE
      //
      // Only if threshold exists and
      // historical total is below it.
      // ------------------------------------------------------

      if (
        row.contribution.status ===
          'nil' &&
        row.threshold != null &&
        row.total != null &&
        row.total < row.threshold
      ) {
        counts[
          await logFineOnce(
            admin,
            {
              memberId:
                member._id,

              amount: 50,

              date:
                row.date,

              reason:
                `Week ${row.week} - NIL contribution (total ${row.total} below threshold ${row.threshold})`,
            }
          )
        ]++;
      }


      // ------------------------------------------------------
      // SAFETY:
      // If an old member row still has an expense embedded
      // inside it, log the expense as GROUP expense.
      //
      // This prevents historical expenses from ever becoming
      // part of the member's personal balance.
      // ------------------------------------------------------

      if (
        row.expenseAmount > 0
      ) {
        const description =
          row.expenseType ||
          'Group expense';

        counts[
          await logExpenseOnce(
            admin,
            {
              typeId:
                groupExpenseType._id,

              amount:
                row.expenseAmount,

              date:
                row.date,

              description:
                `Week ${row.week} ${description} (originally recorded on ${row.name}'s ledger row)`,
            }
          )
        ]++;
      }


      continue;
    }


    // ========================================================
    // LEGACY GROUP ROW
    // ========================================================

    const typeName =
      GROUP_TYPE_NAMES[
        row.rowType
      ];

    if (!typeName) {
      console.warn(
        `  ⚠ Week ${row.week}: unknown rowType "${row.rowType}" — skipped.`
      );

      counts.warning++;

      continue;
    }


    const type =
      await ContributionType.findOne({
        name: typeName,
      });

    if (!type) {
      console.warn(
        `  ⚠ Week ${row.week}: contribution type "${typeName}" not found — skipped.`
      );

      counts.warning++;

      continue;
    }


    // --------------------------------------------------------
    // TEA BALANCE
    // --------------------------------------------------------

    if (
      row.rowType ===
      'tea_balance'
    ) {
      const memberCount =
        memberRowsByWeek.get(
          row.week
        ) || 0;

      const teaCollected =
        row.contribution.amount;

      const memberChai =
        memberCount *
        CHAI_WEEKLY_AMOUNT;

      const total =
        teaCollected +
        memberChai;

      counts[
        await logContributionOnce(
          admin,
          {
            memberId:
              systemMember._id,

            typeId:
              type._id,

            amount:
              total,

            date:
              row.date,

            note:
              `Week ${row.week} tea: ${teaCollected} collected + ${memberChai} member Chai`,
          }
        )
      ]++;
    }


    // --------------------------------------------------------
    // FINES / REGISTRATION / RESIGNATION
    // --------------------------------------------------------

    else if (
      row.contribution.amount > 0
    ) {
      counts[
        await logContributionOnce(
          admin,
          {
            memberId:
              systemMember._id,

            typeId:
              type._id,

            amount:
              row.contribution.amount,

            date:
              row.date,

            note:
              `Week ${row.week} ${
                row.name ||
                row.rowType
              } collected`,
          }
        )
      ]++;
    }


    // --------------------------------------------------------
    // LEGACY GROUP DEBT / EXPENSE
    // --------------------------------------------------------

    if (
      row.debt > 0
    ) {
      counts[
        await logExpenseOnce(
          admin,
          {
            typeId:
              type._id,

            amount:
              row.debt,

            date:
              row.date,

            description:
              `Week ${row.week} ${
                row.name ||
                row.rowType
              } debt/expense from paper ledger`,
          }
        )
      ]++;
    }
  }


  // ==========================================================
  // WELFARE DEDUCTIONS FOR NEXT WEEK
  // ==========================================================

  console.log(
    '\nProcessing welfare deductions...'
  );

  const welfareByMember =
    new Map();


  for (
    const row
    of rows.filter(
      (r) =>
        r.rowType ===
          'member' &&
        r.debt > 0
    )
  ) {
    if (
      !welfareByMember.has(
        row.name
      )
    ) {
      welfareByMember.set(
        row.name,
        []
      );
    }

    welfareByMember
      .get(row.name)
      .push({
        date:
          row.date,

        amount:
          row.debt,

        week:
          row.week,
      });
  }


  let welfareDeductionCount = 0;


  for (
    const [
      memberName,
      welfareList,
    ]
    of welfareByMember.entries()
  ) {
    const member =
      await Member.findOne({
        name: memberName,
      });

    if (!member) {
      console.warn(
        `  ⚠ Welfare deduction skipped: member "${memberName}" not found.`
      );

      counts.warning++;

      continue;
    }


    const welfareType =
      await findOrCreateType(
        'Welfare Contribution',
        {
          description:
            'Welfare/liability contribution carried forward to the following week',
        },
        admin
      );


    for (
      const welfare
      of welfareList.sort(
        (a, b) =>
          a.week - b.week
      )
    ) {

      const nextWeekRows =
        rows.filter(
          (r) =>
            r.rowType ===
              'member' &&
            r.name ===
              memberName &&
            r.week ===
              welfare.week + 1
        );

      if (
        nextWeekRows.length === 0
      ) {
        console.warn(
          `  ⚠ ${memberName}: Week ${welfare.week} welfare of ${welfare.amount} has no Week ${welfare.week + 1} row — no automatic deduction created.`
        );

        counts.warning++;

        continue;
      }


      const nextRow =
        nextWeekRows[0];

      const deductionNote =
        `Week ${welfare.week} welfare deduction (${welfare.amount}) - carried forward`;


      const existing =
        await Contribution.findOne({
          memberId:
            member._id,

          typeId:
            welfareType._id,

          note:
            deductionNote,
        }).select('_id');


      if (existing) {
        counts.duplicate++;

        continue;
      }


      await createLogged(
        Contribution,
        {
          memberId:
            member._id,

          typeId:
            welfareType._id,

          amount:
            -welfare.amount,

          date:
            nextRow.date,

          method:
            'system',

          note:
            deductionNote,

          loggedBy:
            admin._id,
        },
        'Contribution',
        admin
      );


      counts.created++;
      welfareDeductionCount++;
    }
  }


  // ==========================================================
  // FINAL SUMMARY
  // ==========================================================

  console.log(
    '\nImport complete.'
  );

  console.log(
    `Created: ${counts.created}`
  );

  console.log(
    `Already imported (skipped): ${counts.duplicate}`
  );

  console.log(
    `Zero-amount (skipped): ${counts['skipped-zero']}`
  );

  console.log(
    `Warnings: ${counts.warning}`
  );

  console.log(
    `Welfare deductions applied: ${welfareDeductionCount}`
  );

  console.log(
    'No existing database collections were wiped.'
  );

  await mongoose.disconnect();
}


// ============================================================
// ERROR HANDLING
// ============================================================

main().catch(
  async (error) => {
    console.error(
      '\nIMPORT FAILED:'
    );

    console.error(
      error
    );

    await mongoose
      .disconnect()
      .catch(() => {});

    process.exit(1);
  }
);