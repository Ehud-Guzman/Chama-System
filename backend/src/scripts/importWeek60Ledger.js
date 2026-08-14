// One-time bulk import: replaces all member/contribution/fine data with the
// paper ledger for week 60 (dated 05/02/2026). Run manually — NEVER exposed
// as an API endpoint.
//
//   node src/scripts/importWeek60Ledger.js            (dry run — prints the plan, touches nothing)
//   node src/scripts/importWeek60Ledger.js --confirm-wipe   (actually wipes + imports)
//

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
const { logAudit } = require('../utils/auditLogger');

const WEEK_NUMBER = 60;
const SHEET_DATE = new Date('2026-02-05T12:00:00Z');

// Constants
const WEEKLY_CONTRIBUTION_AMOUNT = 1400;
const CHAI_WEEKLY_AMOUNT = 100;

// Group fund totals (PREVIOUS balances from ledger)
const FINES_PENALTIES_PREVIOUS = 81550;
const TEA_BALANCE_PREVIOUS = 78980;
const REGISTRATION_TOTAL = 19200;
const RESIGNATION_PREVIOUS = 28950;

// Week 60 members: [name, previous_total]
// These are closing balances for week 60 (from the PREVIOUS column in week 61 ledger)
const MEMBERS = [
  ['Evans Ndungu', 83600],
  ['Patrick Njuguna', 71000],
  ['Benard Ngugi', 60000],
  ['Ndungu Mbugua', 61300],
  ['Joseph Ndegwa', 82900],
  ['Victor Kamau', 62100],
  ['Peter Kimotho', 66950],
  ['Samson Mwangi', 71550],
  ['David Njoroge', 60000],
  ['John Gatimu', 63600],
  ['Joel Ndungu', 71400],
  ['Benson Maina', 71400],
  ['Benson Kaniu', 79920],
  ['Eustace Mugwanja', 39000],
  ['Joseph Gitonga', 72500],
  ['Wilson Kabichu', 71900],
  ['James Gachara', 40000],
  ['Erick Mwangi', 62150],
  ['Erick Njogu', 37600],
  ['Dennis Wasike', 53600],
  ['Samuel Gachara', 55700],
  ['Zabron Macharia', 70500],
  ['Paul Kimani', 65000],
  ['Dickson Karethi', 65950],
  ['Jackson Nakhulo', 47200],
  ['Isaiah Maina', 70350],
  ['Harrison Kamau', 74300],
  ['Stanly Gachara', 23650],
  ['George Ngechu', 64300],
  ['Joshua Maina', 92700],
  ['Isaac Njenga', 91300],
  ['John Maina', 91100],
];

function placeholderPhone(rowNum) {
  return `07-${String(rowNum).padStart(8, '0')}`;
}

function joinDateFromWeek(sheetDate, weekNumber) {
  // Backdated so this week lands correctly in the schedule
  const weeksBack = weekNumber - 1;
  const d = new Date(sheetDate);
  d.setDate(d.getDate() - weeksBack * 7);
  return d;
}

function dayBefore(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  return d;
}

function snapshot(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  delete obj.__v;
  return obj;
}

async function main() {
  if (!process.argv.includes('--confirm-wipe')) {
    console.log('DRY RUN — nothing will be written. Re-run with --confirm-wipe to actually do this.\n');
    console.log('This would WIPE: Member, Contribution, Fine, FineType, ContributionType, Pledge, Expense, AuditLog.');
    console.log(`It would then create ${MEMBERS.length} members + 1 "Opening Balances" system member,`);
    console.log(`and log opening balance contributions for week 60 (${SHEET_DATE.toISOString().slice(0, 10)}).`);
    console.log('\nWeek 60 member totals (from physical ledger):');
    MEMBERS.forEach(([name, total], i) => {
      console.log(`  ${i + 1}. ${name}: ${total}`);
    });
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
      description: 'Fines and penalties collected from members',
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
      name: 'Opening Balances',
      phone: 'N/A',
      regNumber: 'SYSTEM-001',
      notes: 'System member for group funds (fines, tea, registration, resignation). Not a real member.',
      joinDate,
      createdBy: admin._id,
      active: false,
    },
    'Member'
  );

  console.log(`Importing ${MEMBERS.length} members...`);
  let membersCreated = 0;
  let contributionsLogged = 0;

  for (let i = 0; i < MEMBERS.length; i++) {
    const [name, total] = MEMBERS[i];
    const rowNum = i + 1;

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

    // Cumulative balance as at end of week 60 — dated before the week-1
    // anchor (not SHEET_DATE) so it never lands inside any week's own
    // window and gets mistaken for that week's actual contribution, in
    // either the personal passbook or the chama-wide weekly reconciliation.
    await createLogged(
      Contribution,
      {
        memberId: member._id,
        typeId: weeklyType._id,
        amount: total,
        date: openingDate,
        method: 'other',
        note: `Week ${WEEK_NUMBER} cumulative balance imported from paper ledger`,
        loggedBy: admin._id,
      },
      'Contribution'
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
      date: SHEET_DATE,
      method: 'other',
      note: `Fines/Penalties balance, per paper ledger for week ${WEEK_NUMBER}`,
      loggedBy: admin._id,
    },
    'Contribution'
  );
  contributionsLogged++;

  await createLogged(
    Contribution,
    {
      memberId: systemMember._id,
      typeId: registrationType._id,
      amount: REGISTRATION_TOTAL,
      date: SHEET_DATE,
      method: 'other',
      note: `Registration fees collected, per paper ledger through week ${WEEK_NUMBER}`,
      loggedBy: admin._id,
    },
    'Contribution'
  );
  contributionsLogged++;

  await createLogged(
    Contribution,
    {
      memberId: systemMember._id,
      typeId: chaiType._id,
      amount: TEA_BALANCE_PREVIOUS,
      date: SHEET_DATE,
      method: 'other',
      note: `Chai/tea fund balance, per paper ledger for week ${WEEK_NUMBER}`,
      loggedBy: admin._id,
    },
    'Contribution'
  );
  contributionsLogged++;

  await createLogged(
    Contribution,
    {
      memberId: systemMember._id,
      typeId: resignationType._id,
      amount: RESIGNATION_PREVIOUS,
      date: SHEET_DATE,
      method: 'other',
      note: `Resignation fines balance, per paper ledger for week ${WEEK_NUMBER}`,
      loggedBy: admin._id,
    },
    'Contribution'
  );
  contributionsLogged++;

  console.log('\n✓ Import complete.');
  console.log(`  Members created: ${membersCreated}`);
  console.log(`  Contributions logged: ${contributionsLogged} (week ${WEEK_NUMBER} opening balances + group totals)`);
  console.log(`  Group totals seeded: Fines, Tea, Registration, Resignation`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
