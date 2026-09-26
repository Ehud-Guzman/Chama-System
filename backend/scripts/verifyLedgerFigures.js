#!/usr/bin/env node
/**
 * Do the figures the system shows agree with the documents in the database?
 *
 * Read-only, and deliberately a SECOND opinion rather than a second implementation: each member's
 * money is worked out here the long way — his stored carried-in balance, plus the rows he has paid
 * since the cycle opened, less the tea the group charged him — and compared, member by member,
 * with what the ledger engine says (`computeMemberLedger`, the one function every screen, statement
 * and email goes through). When the two disagree, the engine is wrong or the rows are, and either
 * way it is better to know here than in a meeting.
 *
 * It exists because a committee that doubts a system deserves an answer in figures, not in
 * reassurance: this prints every member it checked, what each computation said, and any difference.
 *
 *   node scripts/verifyLedgerFigures.js
 *   node scripts/verifyLedgerFigures.js --member=harrison    (one member, case-insensitive)
 *
 * What it does NOT do: write anything, build an index, create a Settings row, or send anything.
 */
require('dotenv').config();

const mongoose = require('mongoose');

// This script must not change the database in any way.
mongoose.set('autoIndex', false);

const Member = require('../src/models/Member');
const Contribution = require('../src/models/Contribution');
const ContributionType = require('../src/models/ContributionType');
const Settings = require('../src/models/Settings');
const { computeMemberLedger } = require('../src/utils/memberLedger');
const { bucketForType } = require('../src/utils/ledgerTypes');
const { resolveConfig, scoredWeeks, weekNumberForDate } = require('../src/utils/weekCycle');

const money = (n) => 'Ksh ' + Number(n || 0).toLocaleString('en-KE');
const filterArg = (flag) => {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1).trim().toLowerCase() : null;
};
const NAME_FILTER = filterArg('--member');
// --rows prints every contribution logged since the cycle opened, with the week each one belongs
// to: the answer to "what has actually come in, and where did it land?" without opening the
// database. Read-only like everything else here.
const SHOW_ROWS = process.argv.includes('--rows');
const { toEatDateString } = require('../src/utils/weekCycle');

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set — nothing to check.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`Read-only check of "${mongoose.connection.db.databaseName}" — nothing will be written.\n`);

  const settings = await Settings.findOne({ key: 'main' }).lean();
  if (!settings || !settings.weekAnchorDate) {
    console.error('No Settings row with a week anchor — set the cycle up first.');
    await mongoose.disconnect();
    process.exit(1);
  }
  const config = resolveConfig(settings);
  const weeksClosed = scoredWeeks(config);
  // What the cycle expects of every member right now, and what it has charged them for tea.
  const requiredEach = config.weeklyAmount * weeksClosed;
  const teaEach = config.chaiAmount * weeksClosed;

  const members = await Member.find({ active: true }).sort({ name: 1 }).lean();
  const types = await ContributionType.find().select('name isGroupFund isWeekly').lean();
  const typeById = new Map(types.map((t) => [String(t._id), t]));
  const rows = await Contribution.find({ deleted: false }).lean();

  const byMember = new Map();
  for (const row of rows) {
    const key = String(row.memberId);
    if (!byMember.has(key)) byMember.set(key, []);
    byMember.get(key).push(row);
  }

  console.log(
    `Week ${config.cycleStartWeek + weeksClosed + 1} · ${weeksClosed} week(s) closed · `
    + `${money(config.weeklyAmount)} expected and ${money(config.chaiAmount)} of tea per closed week`
  );
  console.log('');

  if (SHOW_ROWS) {
    const nameById = new Map(members.map((m) => [String(m._id), m.name]));
    const since = rows
      .filter((row) => new Date(row.date) >= new Date(config.anchorDate))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    console.log(`  every row logged since the books opened (${since.length}) — the week it belongs to:`);
    for (const row of since) {
      const type = typeById.get(String(row.typeId));
      console.log(
        `    ${String(nameById.get(String(row.memberId)) || '(a member since removed)').padEnd(24)}`
        + `${toEatDateString(row.date)}  wk${String(weekNumberForDate(row.date, config)).padEnd(4)}`
        + `${money(row.amount).padStart(12)}  ${String(bucketForType(type)).padEnd(7)}`
        + `  ${String(row.note || '').slice(0, 44)}`
      );
    }
    console.log('');
  }


  let mismatches = 0;
  let checked = 0;
  let heldTotal = 0;
  let openingTotal = 0;
  let paidTotal = 0;
  let teaTotal = 0;
  let owedTotal = 0;

  for (const member of members) {
    if (NAME_FILTER && !String(member.name || '').toLowerCase().includes(NAME_FILTER)) continue;
    const own = byMember.get(String(member._id)) || [];

    // ---------------------------------------------------------------- the long way
    let paid = 0;
    let teaBeforeCycle = 0;
    for (const row of own) {
      const type = typeById.get(String(row.typeId));
      const bucket = bucketForType(type);
      const cash = Number(row.grossAmount ?? row.amount) || 0;
      const week = weekNumberForDate(row.date, config);
      if (bucket === 'chai') {
        // Tea collected before the books opened came off his money too; inside the cycle the
        // automatic charge below already covers it.
        if (week < config.cycleStartWeek) teaBeforeCycle += cash;
      } else if (!type?.isGroupFund && (bucket === 'weekly' || bucket === 'extra')) {
        // Only rows dated inside the cycle: what came before is already inside his carried-in
        // balance, which is where the week-92 reset folded it.
        if (week >= config.cycleStartWeek) paid += cash;
      }
    }
    const opening = Number(member.openingBalance) || 0;
    const tea = teaEach + teaBeforeCycle;
    const expectedHeld = opening + paid - tea;
    const expectedOwed = Math.max(0, requiredEach - paid);

    // ---------------------------------------------------------------- the engine
    const annotated = own.map((row) => {
      const type = typeById.get(String(row.typeId));
      return { ...row, bucket: bucketForType(type), isGroupFund: Boolean(type?.isGroupFund) };
    });
    const ledger = computeMemberLedger({ member, contributions: annotated, config });

    checked += 1;
    heldTotal += ledger.money;
    openingTotal += ledger.openingBalance;
    paidTotal += ledger.paid;
    teaTotal += ledger.chai.due;
    owedTotal += ledger.arrears;

    const agrees =
      ledger.money === expectedHeld &&
      ledger.paid === paid &&
      ledger.arrears === expectedOwed &&
      ledger.required === requiredEach;
    if (!agrees) {
      mismatches += 1;
      console.log(`  x ${member.name}`);
      console.log(`      holds   engine ${money(ledger.money)}   documents ${money(expectedHeld)}`);
      console.log(`      paid    engine ${money(ledger.paid)}   documents ${money(paid)}`);
      console.log(`      owed    engine ${money(ledger.arrears)}   documents ${money(expectedOwed)}`);
      continue;
    }
    console.log(
      `  ok ${String(member.name).padEnd(24)}`
      + `carried in ${money(opening).padStart(14)} + paid ${money(paid).padStart(12)}`
      + ` - tea ${money(tea).padStart(8)} = holds ${money(ledger.money).padStart(14)}`
      + ` | owed ${money(ledger.arrears).padStart(10)}`
    );
  }

  console.log('');
  console.log(`  checked                 ${checked} member(s)`);
  console.log(`  carried in (all)        ${money(openingTotal)}`);
  console.log(`  paid in since week ${config.cycleStartWeek}    ${money(paidTotal)}`);
  console.log(`  tea charged             ${money(teaTotal)}`);
  console.log(`  held by members         ${money(heldTotal)}`);
  console.log(
    `  the arithmetic          ${money(openingTotal)} + ${money(paidTotal)} - ${money(teaTotal)}`
    + ` = ${money(openingTotal + paidTotal - teaTotal)}`
    + `${
        openingTotal + paidTotal - teaTotal === heldTotal
          ? '  (agrees with the total above)'
          : '  <- DOES NOT AGREE'
      }`
  );
  console.log(`  owed to the group       ${money(owedTotal)}`);
  console.log(
    mismatches === 0
      ? '\n  Every member agrees: the engine and a plain sum of the documents say the same thing.'
      : `\n  ${mismatches} member(s) disagree - that is a bug, not a rounding difference.`
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nCheck failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
