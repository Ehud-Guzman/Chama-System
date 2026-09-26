#!/usr/bin/env node
/**
 * Who is told he is behind — and who the group's money line leaves alone.
 *
 * Read-only. It writes nothing, builds no index (`autoIndex` is off) and does not even create the
 * Settings row: it reads the row that is there and refuses to guess if there is none. It exists
 * because "why is this member being emailed when he is holding more than the line?" is a question
 * that needs an answer in figures rather than in reasoning about code.
 *
 * It runs the same two functions the reminders screen and the weekly sweep run — the ledger engine
 * through `computeMemberDues` (notificationController) and the line through
 * `moneyLimitForWeek` (utils/reminderLimit) — so what it prints is what those two would do, not a
 * second implementation of the same rule that could disagree with them.
 *
 *   node scripts/reportMoneyLine.js
 *
 * The columns:
 *
 *   held        what the group is holding for him: carried in + paid in since week 92 − tea.
 *               This is the figure the line is measured against.
 *   owed        closed weeks not covered yet (after the line: what he is told about).
 *   fines       unpaid fines, which the line never covers.
 *   told?       whether he appears on the reminders screen for any reason.
 *   because     why not, when he is not there: above the line, nothing outstanding, or a fine.
 */
require('dotenv').config();

const mongoose = require('mongoose');

// Nothing in this script may change the database, index builds included.
mongoose.set('autoIndex', false);

const Member = require('../src/models/Member');
const Settings = require('../src/models/Settings');
// The reminders controller rather than a copy of its maths: a report that re-implemented the rule
// could disagree with the screen, and then there would be two answers to argue about.
const { computeMemberDues } = require('../src/controllers/notificationController');
const { resolveConfig, currentWeekNumber } = require('../src/utils/weekCycle');
const { moneyLimitForWeek, DEFAULT_MONEY_LIMIT } = require('../src/utils/reminderLimit');

const money = (n) => 'Ksh ' + Number(n || 0).toLocaleString('en-KE');
const pad = (text, width) => String(text).padEnd(width).slice(0, width);
const rpad = (text, width) => String(text).padStart(width);

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set — nothing to report.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`Read-only report of "${mongoose.connection.db.databaseName}" — nothing will be written.\n`);

  // Read, never create: getOrCreateSettings() would write a Settings row on a fresh database.
  const settings = await Settings.findOne({ key: 'main' }).lean();
  if (!settings || !settings.weekAnchorDate) {
    console.error('No Settings row with a week anchor — set the cycle up first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const config = resolveConfig(settings);
  const week = currentWeekNumber(config);
  const limit = moneyLimitForWeek(settings, config, week);

  const members = await Member.find({ active: true })
    .select('name regNumber openingBalance')
    .sort({ name: 1 })
    .lean();
  const dues = await computeMemberDues(members, { settings });

  const storedLimit = Number(settings.reminderMoneyLimit ?? DEFAULT_MONEY_LIMIT) || 0;
  console.log(
    `Week ${week} · the weekly contribution is ${money(config.weeklyAmount)} · tea ${money(config.chaiAmount)} a week`
  );
  console.log(
    storedLimit === 0
      ? 'The money line is OFF (reminderMoneyLimit = 0): every member who is behind is told.'
      : `The money line is ${money(limit)} this week — ${money(storedLimit)} as at week ${
          settings.reminderMoneyLimitWeek ?? config.cycleStartWeek
        }, plus ${money(config.weeklyAmount)} a week since. At or above it: not told he is behind.`
  );
  console.log('');
  const rows = members
    .map((member) => {
      const due = dues.get(String(member._id)) || {
        lateWeeks: [],
        lateWeeksIgnored: 0,
        lateTotal: 0,
        finesTotal: 0,
        total: 0,
        moneyHeld: Number(member.openingBalance) || 0,
        coveredByBalance: false,
      };
      return { member, due };
    })
    .sort((a, b) => b.due.moneyHeld - a.due.moneyHeld);

  console.log(
    `  ${pad('member', 26)}${rpad('held', 14)}${rpad('owed', 10)}${rpad('fines', 10)}${rpad('told?', 8)}  because`
  );
  for (const { member, due } of rows) {
    const told = due.total > 0;
    const because = told
      ? due.coveredByBalance
        ? `above the line — ${due.lateWeeksIgnored} closed week(s) not counted, fines still owed`
        : 'behind on contributions and/or fines'
      : 'nothing outstanding';
    console.log(
      `  ${pad(member.name, 26)}${rpad(money(due.moneyHeld), 14)}${rpad(money(due.lateTotal), 10)}`
        + `${rpad(money(due.finesTotal), 10)}${rpad(told ? 'yes' : 'no', 8)}  ${because}`
    );
  }

  const told = rows.filter((r) => r.due.total > 0);
  const above = rows.filter((r) => r.due.coveredByBalance);
  const heldTotal = rows.reduce((sum, r) => sum + r.due.moneyHeld, 0);
  const owedTotal = rows.reduce((sum, r) => sum + r.due.lateTotal, 0);
  const finedTotal = rows.reduce((sum, r) => sum + r.due.finesTotal, 0);

  console.log('');
  console.log(`  ${rows.length} active member(s) · holding ${money(heldTotal)} between them`);
  console.log(`  told about arrears or fines:        ${told.length}`);
  console.log(`  left alone by the money line:       ${above.length}`);
  console.log(`  arrears the group is owed:          ${money(owedTotal)}`);
  console.log(`  unpaid fines:                       ${money(finedTotal)}`);
  if (above.length > 0) {
    console.log('');
    console.log('  Left alone (holds at least the line) — the week stays on the record, and he is not');
    console.log('  told he is behind — on any screen:');
    for (const { member, due } of above) {
      console.log(
        `    ${pad(member.name, 26)}${rpad(money(due.moneyHeld), 14)}  vs line ${money(limit)}`
      );
    }
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nReport failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

