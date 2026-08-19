// Incremental import: adds week 61 contributions to the existing week 60
// members. Confirmed via checkImportState.js that this has never been run
// (0 Contributions/Expenses mentioning "Week 61"), so this is a first run,
// not a re-run — no cleanup needed first.
//
// Differences from the original importWeek61Ledger.js:
//   - Chai is logged as its own "Chai" Contribution (100/member), same as
//     every other week in this system. The original instead created a flat
//     1,500 "Expense" per member tied to weeklyType._id — that's not a real
//     expense, and it broke the "expenses never touch personal balances"
//     rule the rest of the system follows. That's gone.
//   - Duplicate-safe: checks for an existing matching Contribution before
//     creating one, same pattern as importLedgerIncremental.js. Safe to
//     re-run if it fails partway through.
//   - 7 members' contribution amounts are corrected, not the original
//     hardcoded figures. The original numbers didn't reconcile against
//     week 62's "previous" column (confirmed against your ledger screenshot).
//     These 7 are back-calculated as: week62_previous - week60_closing +
//     100 (chai) — i.e. "whatever week 61 contribution makes the books land
//     where week 62 says they landed." That attributes the whole gap to
//     week 61; it's possible the actual error was in week 60's closing
//     balance instead. Flagged in each note — worth checking against the
//     physical week 61 ledger page if you want full certainty:
//       John Gatimu:     3000 -> 9100   (diff 6100)
//       Samuel Gachara:     0 -> 5500   (diff 5500)
//       Isaac Njenga:     900 -> 2350   (diff 1450)
//       Joshua Maina:   20000 -> 20600  (diff 600)
//       Benson Kaniu:    1560 -> 1660   (diff 100)
//       Erick Mwangi:    1600 -> 1700   (diff 100)
//       Dennis Wasike:   7550 -> 7650   (diff 100)
//   - John Maina wasn't visible in the week 62 screenshot, so his original
//     figure (1500) is left as-is, unverified.
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
const { logAudit, snapshot } = require('../utils/auditLogger');

const CONFIRMED = process.argv.includes('--confirm-import');
const SHEET_DATE = new Date('2026-02-12T12:00:00Z');
const WEEK_NUMBER = 61;
const CHAI_WEEKLY_AMOUNT = 100;

// [name, contribution amount, reconciled?]
const MEMBERS = [
  ['Evans Ndungu', 2500, false],
  ['Patrick Njuguna', 0, false],
  ['Benard Ngugi', 2500, false],
  ['Ndungu Mbugua', 1500, false],
  ['Joseph Ndegwa', 2000, false],
  ['Victor Kamau', 0, false],
  ['Peter Kimotho', 4300, false],
  ['Samson Mwangi', 1600, false],
  ['David Njoroge', 1500, false],
  ['John Gatimu', 9100, true],
  ['Joel Ndungu', 3000, false],
  ['Benson Maina', 1500, false],
  ['Benson Kaniu', 1660, true],
  ['Eustace Mugwanja', 1500, false],
  ['Joseph Gitonga', 1500, false],
  ['Wilson Kabichu', 1500, false],
  ['James Gachara', 0, false],
  ['Erick Mwangi', 1700, true],
  ['Erick Njogu', 1000, false],
  ['Dennis Wasike', 7650, true],
  ['Samuel Gachara', 5500, true],
  ['Zabron Macharia', 3000, false],
  ['Paul Kimani', 0, false],
  ['Dickson Karethi', 0, false],
  ['Jackson Nakhulo', 1500, false],
  ['Isaiah Maina', 0, false],
  ['Harrison Kamau', 0, false],
  ['Stanly Gachara', 0, false],
  ['George Ngechu', 0, false],
  ['Joshua Maina', 20600, true],
  ['Isaac Njenga', 2350, true],
  ['John Maina', 1500, false],
];

// Week 61 chama-wide contributions (unchanged from the original script —
// no week-62 equivalent to cross-check these against, so left as-is).
const FINES_PENALTIES_CONTRIBUTION = 21500;
const TEA_BALANCE_CONTRIBUTION = 1640;
const RESIGNATION_CONTRIBUTION = 11700;

async function logContributionOnce(admin, { memberId, typeId, amount, date, note }) {
  if (amount <= 0) return 'skipped-zero';

  const existing = await Contribution.findOne({ memberId, typeId, note }).select('_id');
  if (existing) return 'duplicate';

  const record = await Contribution.create({
    memberId, typeId, amount, date, method: 'cash', note, loggedBy: admin._id,
  });

  await logAudit({
    action: 'create',
    entityType: 'Contribution',
    entityId: record._id,
    performedBy: admin._id,
    after: snapshot(record),
  });

  return 'created';
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const reconciledCount = MEMBERS.filter(([, , reconciled]) => reconciled).length;

  if (!CONFIRMED) {
    console.log('DRY RUN — nothing will be written. Re-run with --confirm-import to actually do this.\n');
    console.log(`This would ADD week ${WEEK_NUMBER} contributions + chai to ${MEMBERS.length} existing members.`);
    console.log(`${reconciledCount} of them use a reconciled amount, not the original paper-ledger figure — see the comment at the top of this file.`);
    const contributorCount = MEMBERS.filter(([, c]) => c > 0).length;
    const totalAmount = MEMBERS.reduce((sum, [, c]) => sum + c, 0);
    console.log(`Contributors: ${contributorCount}/${MEMBERS.length} members`);
    console.log(`Total contributions this week: ${totalAmount}`);
    console.log(`Plus chai: ${MEMBERS.length * CHAI_WEEKLY_AMOUNT}`);
    process.exit(0);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const admin = await User.findOne({ role: 'super_admin' });
  if (!admin) {
    console.error('No super admin found — run seedSuperAdmin.js first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const weeklyType = await ContributionType.findOne({ name: 'Weekly Contribution' });
  const chaiType = await ContributionType.findOne({ name: 'Chai' });
  const finesType = await ContributionType.findOne({ name: 'Fines & Penalties' });
  const resignationType = await ContributionType.findOne({ name: 'Resignation Fines' });

  if (!weeklyType || !chaiType) {
    console.error('Required contribution types not found. Run importWeek60Ledger.js first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const systemMember = await Member.findOne({ name: 'Opening Balances' });
  if (!systemMember) {
    console.error('"Opening Balances" system member not found. Run seedOpeningBalancesMember.js first — the chama-wide Fines/Tea/Resignation contributions below depend on it.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const counts = { created: 0, duplicate: 0, 'skipped-zero': 0, warning: 0 };

  console.log(`Adding week ${WEEK_NUMBER} contributions to ${MEMBERS.length} members...`);

  for (const [name, amount, reconciled] of MEMBERS) {
    const member = await Member.findOne({ name });
    if (!member) {
      console.warn(`  ⚠ Member not found: ${name}`);
      counts.warning++;
      continue;
    }

    const note = reconciled
      ? `Week ${WEEK_NUMBER} contribution (reconciled against week 62 "previous" — verify against physical ledger)`
      : `Week ${WEEK_NUMBER} contribution (paper ledger)`;

    counts[await logContributionOnce(admin, {
      memberId: member._id, typeId: weeklyType._id, amount, date: SHEET_DATE, note,
    })]++;

    counts[await logContributionOnce(admin, {
      memberId: member._id, typeId: chaiType._id, amount: CHAI_WEEKLY_AMOUNT, date: SHEET_DATE,
      note: `Week ${WEEK_NUMBER} Chai (paper ledger)`,
    })]++;
  }

  console.log('Adding chama-wide contributions...');

  counts[await logContributionOnce(admin, {
    memberId: systemMember._id, typeId: finesType._id, amount: FINES_PENALTIES_CONTRIBUTION,
    date: SHEET_DATE, note: `Week ${WEEK_NUMBER} Fines & Penalties collected`,
  })]++;

  const memberChai = MEMBERS.length * CHAI_WEEKLY_AMOUNT;
  counts[await logContributionOnce(admin, {
    memberId: systemMember._id, typeId: chaiType._id, amount: TEA_BALANCE_CONTRIBUTION + memberChai,
    date: SHEET_DATE,
    note: `Week ${WEEK_NUMBER} tea: ${TEA_BALANCE_CONTRIBUTION} collected + ${memberChai} member Chai`,
  })]++;

  counts[await logContributionOnce(admin, {
    memberId: systemMember._id, typeId: resignationType._id, amount: RESIGNATION_CONTRIBUTION,
    date: SHEET_DATE, note: `Week ${WEEK_NUMBER} Resignation fines collected`,
  })]++;

  console.log('\nImport complete.');
  console.log(`Created: ${counts.created}`);
  console.log(`Already imported (skipped): ${counts.duplicate}`);
  console.log(`Zero-amount (skipped): ${counts['skipped-zero']}`);
  console.log(`Warnings: ${counts.warning}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});