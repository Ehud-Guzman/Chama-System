// One-time bulk import: replaces all member/contribution/fine data with the
// paper ledger for week 75 (dated 21/05/2026). Run manually — NEVER exposed
// as an API endpoint, matching the seedSuperAdmin.js / importHarambee
// convention.
//
//   node src/scripts/importWeek75Ledger.js            (dry run — prints the plan, touches nothing)
//   node src/scripts/importWeek75Ledger.js --confirm-wipe   (actually wipes + imports)
//
// WHAT THIS DOES, in order:
//   1. Wipes Member, Contribution, Fine, FineType, ContributionType, Pledge,
//      Expense, and AuditLog collections. Users and Settings are left alone
//      (deleting Users would lock everyone out; Settings holds the chama
//      name/constitution, unrelated to this data).
//   2. Recreates the contribution types this ledger needs: "Weekly
//      Contribution" (1,400/week), "Chai" (100/week, tracks expenses),
//      "Fines & Penalties", "Registration Fees", "Resignation Fund" (tracks
//      expenses).
//   3. Creates the 32 members from the sheet with PLACEHOLDER phone numbers
//      (0700000001, 0700000002, ...) — the real numbers are being collected
//      separately and must be entered via the admin UI before a member can
//      use public phone lookup. joinDate is backdated 74 weeks from the
//      sheet's date so this entry lands as "week 75" in the app's own
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
const SHEET_DATE = new Date('2026-05-21T12:00:00Z');
const WEEK_NUMBER = 75;
const CHAI_WEEKLY_AMOUNT = 100;
const WEEKLY_CONTRIBUTION_AMOUNT = 1400;

// [name, contribution ('NIL' | 'PAID' | number), previousTotal, total, note]
const MEMBERS = [
  ['Evans Ndungu', 5000, 131700, 136600],
  ['Patrick Njuguna', 'NIL', 85950, 85850],
  ['Benard Ngugi', 2000, 103200, 105100],
  ['Ndungu Mbugua', 1000, 75450, 76350],
  ['Joseph Ndegwa', 2000, 89600, 91500],
  ['Victor Kamau', 'PAID', 101400, 101300],
  ['Peter Kimotho', 'NIL', 77150, 77050],
  ['Samson Mwangi', 1500, 89200, 91200],
  ['David Njoroge', 1500, 85400, 86800],
  ['John Gatimu', 'NIL', 86300, 86200],
  ['Joel Ndungu', 1500, 150200, 151600, 'Sheet shows a "+2000" side annotation on this row — not applied, verify with treasurer'],
  ['Benson Maina', 5000, 90010, 94910],
  ['Benson Kaniu', 1640, 95950, 97490, 'Sheet shows a "+10000" side annotation on this row — not applied, verify with treasurer'],
  ['Eustace Mugwanja', 2500, 73950, 76350],
  ['Joseph Gitonga', 2000, 83300, 85200],
  ['Wilson Kabichu', 'NIL', 84600, 84500],
  ['James Gachara', 500, 45200, 45600],
  ['Erick Mwangi', 'NIL', 80350, 80250],
  ['Erick Njogu', 'NIL', 40900, 40800],
  ['Dennis Wasike', 'PAID', 112150, 112050],
  ['Samuel Gachara', 'PAID', 98200, 98100],
  ['Zabron Macharia', 1500, 89500, 90900],
  ['Paul Kimani', 2000, 88400, 90300],
  ['Dickson Karethi', 'PAID', 94450, 94350],
  ['Jackson Nakhulo', 1000, 53050, 53950],
  ['Isaiah Maina', 'PAID', 153050, 152950],
  ['Harrison Kamau', 'PAID', 134000, 133900],
  ['Stanly Gachara', 'NIL', 28550, 28450],
  ['George Ngechu', 'NIL', 85600, 85500],
  ['Joshua Maina', 'PAID', 102400, 102300],
  ['Isaac Njenga', 2000, 85300, 87200],
  ['John Maina', 'NIL', 87550, 87450],
];

// Chama-wide rows from the same sheet, not tied to one member.
const FINES_PENALTIES_TOTAL = 109350; // unchanged this week (NIL)
const REGISTRATION_TOTAL = 19200; // unchanged this week (NIL)
const TEA_BALANCE_PREVIOUS = 100150;
const TEA_BALANCE_CONTRIBUTION_THIS_WEEK = 1560;
const TEA_BALANCE_DEBT_THIS_WEEK = 140;
const RESIGNATION_PREVIOUS = 23550;
const RESIGNATION_TOTAL = 19200; // a payout this week (previous - total)

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
    console.log('and log opening balances + week 75 contributions for each, per the table in this script.');
    console.log('\nConsistency check (Previous + Contribution − 100 should equal Total):');
    let issues = 0;
    for (const [name, contrib, previous, total] of MEMBERS) {
      const n = typeof contrib === 'number' ? contrib : 0;
      const expected = previous + n - CHAI_WEEKLY_AMOUNT;
      if (expected !== total) {
        issues++;
        console.log(`  ⚠ ${name}: expected total ${expected}, sheet says ${total} (diff ${total - expected})`);
      }
    }
    console.log(issues === 0 ? '  All rows reconcile cleanly.' : `  ${issues} row(s) need a manual check against the physical sheet.`);
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
      createdBy: admin._id,
    },
    'ContributionType'
  );
  const finesType = await createLogged(
    ContributionType,
    { name: 'Fines & Penalties', description: 'Historical fines collected', createdBy: admin._id },
    'ContributionType'
  );
  const registrationType = await createLogged(
    ContributionType,
    { name: 'Registration Fees', description: 'One-time member registration fee', createdBy: admin._id },
    'ContributionType'
  );
  const resignationType = await createLogged(
    ContributionType,
    {
      name: 'Resignation Fund',
      description: 'Payouts to members who have resigned',
      tracksExpenses: true,
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

    const expected = previous + (typeof contrib === 'number' ? contrib : 0) - CHAI_WEEKLY_AMOUNT;
    if (expected !== total) {
      warnings.push(
        `Row ${rowNum} (${name}): expected total ${expected}, sheet says ${total} (diff ${total - expected}) — double check against the physical sheet.`
      );
    }
    if (note) warnings.push(`Row ${rowNum} (${name}): ${note}`);

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

    // This week's main contribution — skipped for PAID/NIL (nothing new added, per the sheet's own math).
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

    // This week's Chai contribution — every member, every week, per the group's rule.
    await createLogged(
      Contribution,
      {
        memberId: member._id,
        typeId: chaiType._id,
        amount: CHAI_WEEKLY_AMOUNT,
        date: SHEET_DATE,
        method: 'cash',
        note: `Week ${WEEK_NUMBER} Chai contribution (paper ledger)`,
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
      amount: FINES_PENALTIES_TOTAL,
      date: openingDate,
      method: 'other',
      note: `Historical fines collected, per paper ledger through week ${WEEK_NUMBER - 1}`,
      loggedBy: admin._id,
    },
    'Contribution'
  );

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
  await createLogged(
    Contribution,
    {
      memberId: systemMember._id,
      typeId: chaiType._id,
      amount: TEA_BALANCE_CONTRIBUTION_THIS_WEEK,
      date: SHEET_DATE,
      method: 'other',
      note: `Week ${WEEK_NUMBER} tea/refreshments cash collected, per paper ledger — separate from the per-member Chai contributions above, verify with treasurer this isn't double counted`,
      loggedBy: admin._id,
    },
    'Contribution'
  );
  await createLogged(
    Expense,
    {
      typeId: chaiType._id,
      amount: TEA_BALANCE_DEBT_THIS_WEEK,
      date: SHEET_DATE,
      description: `Week ${WEEK_NUMBER} tea/refreshments debt, per paper ledger`,
      loggedBy: admin._id,
    },
    'Expense'
  );

  await createLogged(
    Contribution,
    {
      memberId: systemMember._id,
      typeId: resignationType._id,
      amount: RESIGNATION_PREVIOUS,
      date: openingDate,
      method: 'other',
      note: `Opening resignation fund balance, per paper ledger through week ${WEEK_NUMBER - 1}`,
      loggedBy: admin._id,
    },
    'Contribution'
  );
  const resignationPayout = RESIGNATION_PREVIOUS - RESIGNATION_TOTAL;
  if (resignationPayout > 0) {
    await createLogged(
      Expense,
      {
        typeId: resignationType._id,
        amount: resignationPayout,
        date: SHEET_DATE,
        description: `Resignation payout, week ${WEEK_NUMBER}, per paper ledger`,
        loggedBy: admin._id,
      },
      'Expense'
    );
  }

  console.log('\n--- Import complete ---');
  console.log(`Members created:      ${membersCreated}`);
  console.log(`Contributions logged: ${contributionsLogged}`);
  console.log('\nIMPORTANT: every member has a PLACEHOLDER phone number (0700000001, 0700000002, ...).');
  console.log('Public phone lookup will not work for them until real numbers are entered via');
  console.log('the admin UI (Members → open member → Edit).');

  if (warnings.length > 0) {
    console.log(`\n${warnings.length} thing(s) worth a manual look:`);
    warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
