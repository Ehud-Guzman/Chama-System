// Incremental import: adds week 61 contributions to existing week 60 members.
// Run AFTER importWeek60Ledger.js has been executed.
//
//   node src/scripts/importWeek61Ledger.js            (dry run)
//   node src/scripts/importWeek61Ledger.js --confirm-import   (actually imports)
//

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const Expense = require('../models/Expense');
const AuditLog = require('../models/AuditLog');
const { logAudit, snapshot } = require('../utils/auditLogger');

const CONFIRMED = process.argv.includes('--confirm-import');
const SHEET_DATE = new Date('2026-02-12T12:00:00Z');
const WEEK_NUMBER = 61;
const CHAI_WEEKLY_AMOUNT = 100;
const WEEKLY_CONTRIBUTION_AMOUNT = 1400;

// Week 61 contributions: [name, contribution ('NIL' | number)]
const MEMBERS = [
  ['Evans Ndungu', 2500],
  ['Patrick Njuguna', 'NIL'],
  ['Benard Ngugi', 2500],
  ['Ndungu Mbugua', 1500],
  ['Joseph Ndegwa', 2000],
  ['Victor Kamau', 'NIL'],
  ['Peter Kimotho', 4300],
  ['Samson Mwangi', 1600],
  ['David Njoroge', 1500],
  ['John Gatimu', 3000],
  ['Joel Ndungu', 3000],
  ['Benson Maina', 1500],
  ['Benson Kaniu', 1500],
  ['Eustace Mugwanja', 1500],
  ['Joseph Gitonga', 1500],
  ['Wilson Kabichu', 1500],
  ['James Gachara', 'NIL'],
  ['Erick Mwangi', 1600],
  ['Erick Njogu', 1000],
  ['Dennis Wasike', 7550],
  ['Samuel Gachara', 'NIL'],
  ['Zabron Macharia', 3000],
  ['Paul Kimani', 'NIL'],
  ['Dickson Karethi', 'NIL'],
  ['Jackson Nakhulo', 1500],
  ['Isaiah Maina', 'NIL'],
  ['Harrison Kamau', 'NIL'],
  ['Stanly Gachara', 'NIL'],
  ['George Ngechu', 'NIL'],
  ['Joshua Maina', 20000],
  ['Isaac Njenga', 900],
  ['John Maina', 1500],
];

// Week 61 chama-wide contributions
const FINES_PENALTIES_CONTRIBUTION = 21500;
const TEA_BALANCE_CONTRIBUTION = 1640;
const RESIGNATION_CONTRIBUTION = 11700;

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  if (!CONFIRMED) {
    console.log('DRY RUN — nothing will be written. Re-run with --confirm-import to actually do this.\n');
    console.log(`This would ADD week 61 contributions to the existing 32 members.`);
    const contributorCount = MEMBERS.filter(([, c]) => c !== 'NIL').length;
    const totalAmount = MEMBERS.reduce((sum, [, c]) => sum + (c === 'NIL' ? 0 : c), 0);
    console.log(`Contributors: ${contributorCount}/32 members`);
    console.log(`Total contributions this week: ${totalAmount}`);
    process.exit(0);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const admin = await User.findOne({ role: 'super_admin' });
  if (!admin) {
    console.error('No super admin found — run seedSuperAdmin.js first.');
    await mongoose.disconnect();
    process.exit(1);
  }

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

  console.log('Loading contribution types...');
  const weeklyType = await ContributionType.findOne({ name: 'Weekly Contribution' });
  const chaiType = await ContributionType.findOne({ name: 'Chai' });
  const finesType = await ContributionType.findOne({ name: 'Fines & Penalties' });
  const resignationType = await ContributionType.findOne({ name: 'Resignation Fines' });

  if (!weeklyType || !chaiType) {
    console.error('Required contribution types not found. Run importWeek60Ledger.js first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Adding week ${WEEK_NUMBER} contributions to ${MEMBERS.length} members...`);
  let contributionsLogged = 0;

  for (let i = 0; i < MEMBERS.length; i++) {
    const [name, contrib] = MEMBERS[i];
    const rowNum = i + 1;

    // Find existing member by name
    const member = await Member.findOne({ name });
    if (!member) {
      console.warn(`  ⚠ Member not found: ${name}`);
      continue;
    }

    process.stdout.write(`  [${rowNum}/32] ${name}...`);

    // Week 61 contribution (if any)
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

    process.stdout.write(' ✓\n');
  }

  console.log('Adding chama-wide contributions...');
  const systemMember = await Member.findOne({ name: 'Opening Balances' });
  if (systemMember) {
    if (FINES_PENALTIES_CONTRIBUTION > 0) {
      await createLogged(
        Contribution,
        {
          memberId: systemMember._id,
          typeId: finesType._id,
          amount: FINES_PENALTIES_CONTRIBUTION,
          date: SHEET_DATE,
          method: 'cash',
          note: `Week ${WEEK_NUMBER} Fines & Penalties collected`,
          loggedBy: admin._id,
        },
        'Contribution'
      );
      contributionsLogged++;
    }

    if (TEA_BALANCE_CONTRIBUTION > 0) {
      await createLogged(
        Contribution,
        {
          memberId: systemMember._id,
          typeId: chaiType._id,
          amount: TEA_BALANCE_CONTRIBUTION + (MEMBERS.length * CHAI_WEEKLY_AMOUNT),
          date: SHEET_DATE,
          method: 'cash',
          note: `Week ${WEEK_NUMBER} tea: ${TEA_BALANCE_CONTRIBUTION} collected + ${MEMBERS.length * CHAI_WEEKLY_AMOUNT} chai from members`,
          loggedBy: admin._id,
        },
        'Contribution'
      );
      contributionsLogged++;
    }

    if (RESIGNATION_CONTRIBUTION > 0) {
      await createLogged(
        Contribution,
        {
          memberId: systemMember._id,
          typeId: resignationType._id,
          amount: RESIGNATION_CONTRIBUTION,
          date: SHEET_DATE,
          method: 'cash',
          note: `Week ${WEEK_NUMBER} Resignation fines collected`,
          loggedBy: admin._id,
        },
        'Contribution'
      );
      contributionsLogged++;
    }
  }

  console.log('\n✓ Import complete.');
  console.log(`  Contributions logged: ${contributionsLogged}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
