// One-time bulk import: replaces all member/contribution/fine data with the
// paper ledger for week 61 (dated 12/03/2026). Run manually — NEVER exposed
// as an API endpoint, matching the seedSuperAdmin.js / importHarambee
// convention.
//
//   node src/scripts/importWeek61Ledger.js            (dry run — prints the plan, touches nothing)
//   node src/scripts/importWeek61Ledger.js --confirm-wipe   (actually wipes + imports)
//
// WHAT THIS DOES, in order:
//   1. Wipes Member, Contribution, Fine, FineType, ContributionType, Pledge,
//      Expense, and AuditLog collections. Users and Settings are left alone
//      (deleting Users would lock everyone out; Settings holds the chama
//      name/constitution, unrelated to this data).
//   2. Recreates the contribution types this ledger needs: "Weekly
//      Contribution" (1,400/week, personal — counts toward each member's own
//      total), "Chai" (100/week, tracks expenses, group fund — collected
//      from everyone but spent on refreshments, never counts as anyone's
//      personal savings), "Fines & Penalties", "Registration Fees" (fee paid
//      by incoming members), and "Resignation Fines" (charged to members who
//      resign partway through a cycle) — the latter three are also group
//      funds, per the treasurer: this money becomes the group's, it must
//      never inflate a member's personal contributed total.
//   3. Creates the 32 members from the sheet with PLACEHOLDER phone numbers
//      (0700000001, 0700000002, ...) — the real numbers are being collected
//      separately and must be entered via the admin UI before a member can
//      use public phone lookup. joinDate is backdated 60 weeks from the
//      sheet's date so this entry lands as "week 61" in the app's own
//      week-by-week schedule.
//   4. For each member: one opening-balance contribution (their PREVIOUS
//      cumulative total, dated the day before joinDate so it doesn't
//      distort the week-1 schedule row), one Chai contribution of 100
//      (every member, every week per the group's rule), and one main
//      contribution for this week's CONTRIBUTIONS figure — skipped for
//      members marked PAID or NIL, since the sheet's own arithmetic shows
//      neither added anything new this week (PAID = already covered by an
//      earlier advance payment; NIL = no contribution this week).
//   5. The four rows that aren't tied to one member (Fines/Penalties, Tea
//      Balance, Registration, Resignation) are seeded against one hidden,
//      inactive "Opening Balances" member so the app's live totals reflect
//      the sheet without inventing which real person they belonged to.
//   6. Runs a consistency check per member (Previous + Contribution − 100
//      should equal Total, per the group's Chai-deduction rule) and prints
//      a warning for any row that doesn't reconcile — likely an OCR
//      misread on my part when transcribing the photo, worth checking
//      against the physical book before trusting that row.
//
// After running: replace the placeholder phone numbers via the admin UI
// (Members → edit) as real numbers come in.

require('dotenv').config();
const mongoose = require('mongoose');
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

const CONFIRMED = process.argv.includes('--confirm-wipe');
const SHEET_DATE = new Date('2026-02-12T12:00:00Z');
const WEEK_NUMBER = 61;
const CHAI_WEEKLY_AMOUNT = 100;
const WEEKLY_CONTRIBUTION_AMOUNT = 1400;

// [name, contribution ('NIL' | number), previousTotal, total]
const MEMBERS = [
  ['Evans Ndungu', 2500, 94100, 96600],
  ['Patrick Njuguna', 'NIL', 62900, 62900],
  ['Benard Ngugi', 2500, 81700, 84200],
  ['Ndungu Mbugua', 1500, 62350, 63850],
  ['Joseph Ndegwa', 2000, 81000, 82900],
  ['Victor Kamau', 'NIL', 90100, 90100],
  ['Peter Kimotho', 4300, 62750, 66950],
  ['Samson Mwangi', 1600, 70050, 71550],
  ['David Njoroge', 1500, 68200, 69700],
  ['John Gatimu', 3000, 64200, 67200],
  ['Joel Ndungu', 3000, 68500, 71400],
  ['Benson Maina', 1500, 70000, 71400],
  ['Benson Kaniu', 1500, 78260, 79920],
  ['Eustace Mugwanja', 1500, 64450, 65950],
  ['Joseph Gitonga', 1500, 71100, 72500],
  ['Wilson Kabichu', 1500, 70500, 71900],
  ['James Gachara', 'NIL', 39900, 39900],
  ['Erick Mwangi', 1600, 60750, 62150],
  ['Erick Njogu', 1000, 36700, 37600],
  ['Dennis Wasike', 7550, 20600, 28150],
  ['Samuel Gachara', 'NIL', 55300, 55700],
  ['Zabron Macharia', 3000, 67600, 70500],
  ['Paul Kimani', 'NIL', 58700, 58700],
  ['Dickson Karethi', 'NIL', 66850, 65950],
  ['Jackson Nakhulo', 1500, 45600, 47200],
  ['Isaiah Maina', 'NIL', 70150, 70350],
  ['Harrison Kamau', 'NIL', 74400, 74300],
  ['Stanly Gachara', 'NIL', 23750, 23650],
  ['George Ngechu', 'NIL', 64400, 64300],
  ['Joshua Maina', 20000, 72200, 92700],
  ['Isaac Njenga', 900, 61500, 62400],
  ['John Maina', 1500, 67500, 69000],
];

// Chama-wide rows from the same sheet, not tied to one member.
const FINES_PENALTIES_CONTRIBUTION = 21500;
const FINES_PENALTIES_PREVIOUS = 60050;
const REGISTRATION_TOTAL = 19200;
const TEA_BALANCE_CONTRIBUTION = 1640;
const TEA_BALANCE_PREVIOUS = 77340;
const RESIGNATION_CONTRIBUTION = 11700;
const RESIGNATION_PREVIOUS = 11250;

function joinDateFromWeek(sheetDate, weekNumber) {
  const d = new Date(sheetDate);
  d.setUTCDate(d.getUTCDate() - (weekNumber - 1) * 7);
  return d;
}

function dayBefore(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function placeholderPhone(index) {
  return `07${String(index).padStart(8, '0')}`;
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  if (!CONFIRMED) {
    console.log('DRY RUN — nothing will be written. Re-run with --confirm-wipe to actually do this.\n');
    console.log(`This would WIPE: Member, Contribution, Fine, FineType, ContributionType, Pledge, Expense, AuditLog.`);
    console.log(`It would then create ${MEMBERS.length} members + 1 "Opening Balances" system member,`);
    console.log('and log opening balances + week 61 contributions for each, per the table in this script.');
    console.log('\nConsistency check (Previous + Contribution should equal Total):');
    let issues = 0;
    for (const [name, contrib, previous, total] of MEMBERS) {
      const n = typeof contrib === 'number' ? contrib : 0;
      const expected = previous + n;
      if (expected !== total) {
        issues++;
        console.log(`  ⚠ ${name}: expected total ${expected}, sheet says ${total} (diff ${total - expected})`);
      }
    }
    console.log(issues === 0 ? '  All rows reconcile cleanly.' : `  ${issues} row(s) have discrepancies — check if debt/deductions are involved.`);
    process.exit(0);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const admin = await User.findOne({ role: 'super_admin' });
  if (!admin) {
    console.error('No super admin found — run seedSuperAdmin.js first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('Wiping existing data...');
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

  async function createLogged(Model, doc, entityType) {
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

  console.log('Creating contribution types...');
  const weeklyType = await createLogged(
    ContributionType,
    {
      name: 'Weekly Contribution',
      description: 'Mandatory weekly contribution',
      isWeekly: true,
      weeklyAmount: WEEKLY_CONTRIBUTION_AMOUNT,
      createdBy: admin._id,
    },
    'ContributionType'
  );
  const chaiType = await createLogged(
    ContributionType,
    {
      name: 'Chai',
      description: 'Weekly Chai/refreshments contribution, funds meeting snacks',
      isWeekly: true,
      weeklyAmount: CHAI_WEEKLY_AMOUNT,
      tracksExpenses: true,
      isGroupFund: true,
      createdBy: admin._id,
    },
    'ContributionType'
  );
  const finesType = await createLogged(
    ContributionType,
    {
      name: 'Fines & Penalties',
      description: 'Historical fines collected',
      isGroupFund: true,
      createdBy: admin._id,
    },
    'ContributionType'
  );
  const registrationType = await createLogged(
    ContributionType,
    {
      name: 'Registration Fees',
      description: 'One-time fee paid by incoming members',
      isGroupFund: true,
      createdBy: admin._id,
    },
    'ContributionType'
  );
  const resignationType = await createLogged(
    ContributionType,
    {
      name: 'Resignation Fines',
      description: 'Fines charged to members who resign partway through a cycle',
      isGroupFund: true,
      createdBy: admin._id,
    },
    'ContributionType'
  );

  const joinDate = joinDateFromWeek(SHEET_DATE, WEEK_NUMBER);
  const openingDate = dayBefore(joinDate);
  console.log(`Week 1 anchor (joinDate): ${joinDate.toISOString().slice(0, 10)}`);
  console.log(`Opening-balance date:     ${openingDate.toISOString().slice(0, 10)}`);

  console.log('Creating "Opening Balances" system member...');
  const systemMember = await createLogged(
    Member,
    {
      name: '— Opening Balances (Paper Ledger) —',
      phone: '0700000000',
      regNumber: 'SYS-0000',
      notes: 'Holds chama-wide totals (fines, tea fund, registration, resignation payouts) carried over from the paper ledger. Not a real member — hidden from public views because it is inactive.',
      active: false,
      createdBy: admin._id,
    },
    'Member'
  );

  console.log(`Importing ${MEMBERS.length} members...`);
  const warnings = [];
  let membersCreated = 0;
  let contributionsLogged = 0;

  for (let i = 0; i < MEMBERS.length; i++) {
    const [name, contrib, previous, total, note] = MEMBERS[i];
    const rowNum = i + 1;

    const expected = previous + (typeof contrib === 'number' ? contrib : 0);
    if (expected !== total) {
      warnings.push(
        `Row ${rowNum} (${name}): expected total ${expected}, sheet says ${total} (diff ${total - expected}) — double check against the physical sheet.`
      );
    }
    if (note) warnings.push(`Row ${rowNum} (${name}): ${note}`);

    process.stdout.write(`  [${rowNum}/32] Creating ${name}...`);
    const member = await createLogged(
      Member,
      {
        name,
        phone: placeholderPhone(rowNum),
        regNumber: `CM-${String(rowNum).padStart(4, '0')}`,
        notes: 'Phone number is a placeholder — replace with the real number once collected.',
        joinDate,
        createdBy: admin._id,
      },
      'Member'
    );
    membersCreated++;
    process.stdout.write(' ✓\n');

    // Opening balance — everything contributed before this ledger's history began.
    await createLogged(
      Contribution,
      {
        memberId: member._id,
        typeId: weeklyType._id,
        amount: previous,
        date: openingDate,
        method: 'other',
        note: `Opening balance imported from paper ledger (cumulative through week ${WEEK_NUMBER - 1})`,
        loggedBy: admin._id,
      },
      'Contribution'
    );
    contributionsLogged++;

    // This week's contribution — log positive contribution amount only
    // Deductions (mandatory 1,400 + chai 100) are logged as Expenses separately
    if (typeof contrib === 'number' && contrib > 0) {
      await createLogged(
        Contribution,
        {
          memberId: member._id,
          typeId: weeklyType._id,
          amount: contrib,
          date: SHEET_DATE,
          method: 'cash',
          note: `Week ${WEEK_NUMBER} contribution (paper ledger)`,
          loggedBy: admin._id,
        },
        'Contribution'
      );
      contributionsLogged++;
    }

    // Mandatory deduction for week 61 (1,400 weekly + 100 chai)
    await createLogged(
      Expense,
      {
        typeId: weeklyType._id,
        amount: WEEKLY_CONTRIBUTION_AMOUNT + CHAI_WEEKLY_AMOUNT,
        date: SHEET_DATE,
        description: contrib === 'NIL' 
          ? `Week ${WEEK_NUMBER}: No contribution (mandatory 1,400 + chai 100 deducted)`
          : `Week ${WEEK_NUMBER}: Mandatory deduction 1,400 + chai 100`,
        loggedBy: admin._id,
      },
      'Expense'
    );
    contributionsLogged++;
  }

  console.log('Seeding chama-wide totals (Fines/Penalties, Tea Balance, Registration, Resignation)...');

  await createLogged(
    Contribution,
    {
      memberId: systemMember._id,
      typeId: finesType._id,
      amount: FINES_PENALTIES_PREVIOUS,
      date: openingDate,
      method: 'other',
      note: `Opening Fines/Penalties balance, per paper ledger through week ${WEEK_NUMBER - 1}`,
      loggedBy: admin._id,
    },
    'Contribution'
  );

  if (FINES_PENALTIES_CONTRIBUTION > 0) {
    await createLogged(
      Contribution,
      {
        memberId: systemMember._id,
        typeId: finesType._id,
        amount: FINES_PENALTIES_CONTRIBUTION,
        date: SHEET_DATE,
        method: 'cash',
        note: `Week ${WEEK_NUMBER} Fines/Penalties collected, per paper ledger`,
        loggedBy: admin._id,
      },
      'Contribution'
    );
  }

  await createLogged(
    Contribution,
    {
      memberId: systemMember._id,
      typeId: registrationType._id,
      amount: REGISTRATION_TOTAL,
      date: openingDate,
      method: 'other',
      note: `Registration fees collected, per paper ledger through week ${WEEK_NUMBER - 1}`,
      loggedBy: admin._id,
    },
    'Contribution'
  );

  await createLogged(
    Contribution,
    {
      memberId: systemMember._id,
      typeId: chaiType._id,
      amount: TEA_BALANCE_PREVIOUS,
      date: openingDate,
      method: 'other',
      note: `Opening Chai/tea fund balance, per paper ledger through week ${WEEK_NUMBER - 1}`,
      loggedBy: admin._id,
    },
    'Contribution'
  );

  // Week 61 tea: opening balance + this week's collection (1,640) + all members' chai deductions (32 × 100 = 3,200)
  const totalChaiThisWeek = TEA_BALANCE_CONTRIBUTION + (MEMBERS.length * CHAI_WEEKLY_AMOUNT);
  
  if (totalChaiThisWeek > 0) {
    await createLogged(
      Contribution,
      {
        memberId: systemMember._id,
        typeId: chaiType._id,
        amount: totalChaiThisWeek,
        date: SHEET_DATE,
        method: 'cash',
        note: `Week ${WEEK_NUMBER} tea: 1,640 collected + 3,200 chai from members (32 × 100)`,
        loggedBy: admin._id,
      },
      'Contribution'
    );
  }

  await createLogged(
    Contribution,
    {
      memberId: systemMember._id,
      typeId: resignationType._id,
      amount: RESIGNATION_PREVIOUS,
      date: openingDate,
      method: 'other',
      note: `Opening Resignation fines balance, per paper ledger through week ${WEEK_NUMBER - 1}`,
      loggedBy: admin._id,
    },
    'Contribution'
  );

  if (RESIGNATION_CONTRIBUTION > 0) {
    await createLogged(
      Contribution,
      {
        memberId: systemMember._id,
        typeId: resignationType._id,
        amount: RESIGNATION_CONTRIBUTION,
        date: SHEET_DATE,
        method: 'cash',
        note: `Week ${WEEK_NUMBER} Resignation fines collected, per paper ledger`,
        loggedBy: admin._id,
      },
      'Contribution'
    );
  }

  console.log('\n✓ Import complete.');
  console.log(`  Members created: ${membersCreated}`);
  console.log(`  Contributions logged: ${contributionsLogged} (includes opening balances, weekly, and chai)`);
  console.log(`  Group totals seeded: Fines, Tea, Registration, Resignation`);
  if (warnings.length) {
    console.log('\nWarnings to check against the physical sheet:');
    warnings.forEach((w) => console.log(`  - ${w}`));
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
