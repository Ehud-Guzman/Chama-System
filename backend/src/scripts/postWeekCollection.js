/**
 * A whole week collected in one go, from the command line.
 *
 * `POST /api/ledger/collect-week` does this from the go-live screen, but that
 * needs the API deployed and somebody logged in. This is the same write, run
 * where the database already is. Week 91 — the week the paper ledger closed just
 * before the books opened, where every member paid the week's 1,400 and the
 * week's 100 tea — is the case it exists for, and nobody should hand-enter 64
 * rows to get it.
 *
 * WHAT IT DOES
 *
 *   1. reads the week's window off the week cycle (Friday→Thursday) and dates
 *      every row on the Thursday that week closed, so the money is counted
 *      against the week it was collected in rather than against today
 *   2. leaves alone any member who already has a row of that kind in that week —
 *      a payment logged by hand is never doubled up — and any member this batch
 *      already posted, since each row carries a deterministic clientRequestId
 *      (`week91-<memberId>-weekly`, `-chai`)
 *   3. prints every member's row and the totals; `--confirm-write` posts them
 *
 * Usage:
 *
 *   Dry run (the default — writes nothing, prints the whole plan):
 *     node src/scripts/postWeekCollection.js
 *
 *   Post it:
 *     node src/scripts/postWeekCollection.js --confirm-write
 *
 *   A different week, or different figures:
 *     node src/scripts/postWeekCollection.js --week=91 --weekly=1400 --chai=100 --method=cash
 *     node src/scripts/postWeekCollection.js --note="Week 91, collected 10 Sept"
 *
 *   Take the whole batch back out (soft delete, the same as the screen's Undo):
 *     node src/scripts/postWeekCollection.js --undo --confirm-write
 *
 * ONE THING TO SET FIRST: the week cycle. These rows are dated on the Thursday
 * week 91 closed, and the engine treats a week that ended *before* the cycle
 * opened as history — its money as paid, its tea against the Tea Fund. A week
 * that is the cycle's own opening week is the baseline, and the baseline carries
 * no tea at all, so post week 91 while `Week number now` is **92** (Friday
 * 11/09/2026), not 91.
 */
require('dotenv').config();

const mongoose = require('mongoose');

const Contribution = require('../models/Contribution');
const Member = require('../models/Member');
const User = require('../models/User');
const { logAudit } = require('../utils/auditLogger');
const { getOrCreateSettings } = require('../utils/settings');
const {
  resolveConfig,
  currentWeekNumber,
  weekRange,
  parseEatDate,
  toEatDateString,
} = require('../utils/weekCycle');
const { getLedgerTypes } = require('../utils/ledgerTypes');

const METHODS = ['cash', 'bank', 'mobile', 'other'];
const CONFIRMED = process.argv.includes('--confirm-write');
const UNDO = process.argv.includes('--undo');

// Reads `--flag=value`, or null when the flag is absent or given without a value.
function argValue(flag) {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit || !hit.includes('=')) return null;
  const value = hit.slice(hit.indexOf('=') + 1).trim();
  return value === '' ? null : value;
}

const money = (n) => 'Ksh ' + Number(n || 0).toLocaleString('en-KE');
const day = (d) => toEatDateString(new Date(d));

(async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);

  const settings = await getOrCreateSettings();
  const config = resolveConfig(settings);
  const current = currentWeekNumber(config);
  const week = Number(argValue('--week') ?? 91);

  console.log(
    `\nweek cycle: start week ${config.cycleStartWeek}, weekly ${money(
      config.weeklyAmount
    )}, tea ${money(config.chaiAmount)} · today is week ${current}`
  );

  // --- undo ------------------------------------------------------------------
  // The screen's Undo marks the same rows deleted, by the same prefix, so the two
  // are interchangeable: whatever posted the batch, either can take it out.
  if (UNDO) {
    const filter = { clientRequestId: new RegExp(`^week${week}-`), deleted: false };
    const rows = await Contribution.find(filter).select('memberId amount typeId').lean();
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    console.log(
      `\nundo week ${week}: ${rows.length} row(s), ${money(total)} — ${
        new Set(rows.map((r) => String(r.memberId))).size
      } member(s)`
    );
    if (rows.length === 0) {
      console.log('Nothing to take out.');
      await mongoose.disconnect();
      return;
    }
    if (!CONFIRMED) {
      console.log('\nDRY RUN — nothing written. Re-run with --undo --confirm-write.');
      await mongoose.disconnect();
      return;
    }
    const res = await Contribution.updateMany(filter, { $set: { deleted: true } });
    const admin = await User.findOne({ role: 'super_admin' }).lean();
    if (admin) {
      await logAudit({
        action: 'delete',
        entityType: 'System',
        entityId: settings._id,
        performedBy: admin._id,
        before: {
          action: 'undo-collect-week',
          script: 'src/scripts/postWeekCollection.js',
          weekNumber: week,
          removed: res.modifiedCount,
          total,
        },
      });
    }
    console.log(`\nremoved ${res.modifiedCount} row(s).`);
    await mongoose.disconnect();
    return;
  }

  // --- validate --------------------------------------------------------------
  if (!Number.isInteger(week) || week < 1) {
    console.error('--week must be a whole number of at least 1');
    process.exit(1);
  }
  if (week > current) {
    console.error(`Week ${week} has not started yet — the ledger is in week ${current}.`);
    process.exit(1);
  }
  const weekly = Number(argValue('--weekly') ?? config.weeklyAmount);
  const chai = Number(argValue('--chai') ?? config.chaiAmount);
  const method = argValue('--method') || 'cash';
  if (!Number.isFinite(weekly) || weekly <= 0) {
    console.error('--weekly must be greater than zero');
    process.exit(1);
  }
  if (!Number.isFinite(chai) || chai < 0) {
    console.error('--chai cannot be negative');
    process.exit(1);
  }
  if (!METHODS.includes(method)) {
    console.error(`--method must be one of: ${METHODS.join(', ')}`);
    process.exit(1);
  }

  const types = await getLedgerTypes();
  if (!types.weekly) {
    console.error('No weekly contribution type — run the ledger setup again.');
    process.exit(1);
  }
  if (chai > 0 && !types.chai) {
    console.error('No tea type — run the ledger setup again.');
    process.exit(1);
  }

  // The Thursday the week closed, at midnight EAT: the day the cash was counted
  // and the day every screen reads the week off.
  const range = weekRange(week, config);
  const when = parseEatDate(toEatDateString(range.endDate));
  const text = argValue('--note') || `Week ${week} collection — posted in one go`;
  console.log(
    `\nweek ${week}: ${day(range.startDate)} → ${day(range.endDate)}, rows dated ${day(
      when
    )} (${method})${when > new Date() ? '  [IN THE FUTURE?]' : ''}`
  );

  // --- what each member needs -----------------------------------------------
  const members = await Member.find({ active: true }).sort({ name: 1 }).lean();
  const memberIds = members.map((m) => m._id);

  // Anything already logged by hand for that week: the batch adds nothing on top
  // of it, the same kindness the API shows a member it has already posted. This
  // is what keeps a week that was part-entered from being collected twice.
  const inWeek = await Contribution.find({
    memberId: { $in: memberIds },
    deleted: false,
    date: { $gte: range.startDate, $lte: range.endDate },
  })
    .select('memberId typeId')
    .lean();
  const weeklyTypeId = String(types.weekly._id);
  const chaiTypeId = types.chai ? String(types.chai._id) : null;
  const hasWeekly = new Set(
    inWeek.filter((r) => String(r.typeId) === weeklyTypeId).map((r) => String(r.memberId))
  );
  const hasChai = new Set(
    inWeek
      .filter((r) => chaiTypeId && String(r.typeId) === chaiTypeId)
      .map((r) => String(r.memberId))
  );

  // And anything this batch already wrote, matched on the deterministic key.
  const clientIds = members.flatMap((m) => [
    `week${week}-${m._id}-weekly`,
    `week${week}-${m._id}-chai`,
  ]);
  const existing = await Contribution.find({ clientRequestId: { $in: clientIds } })
    .select('clientRequestId')
    .lean();
  const alreadyPosted = new Set(existing.map((e) => e.clientRequestId));

  const plan = members.map((m) => {
    const id = String(m._id);
    const weeklyId = `week${week}-${id}-weekly`;
    const chaiId = `week${week}-${id}-chai`;
    const whyWeekly = hasWeekly.has(id)
      ? 'already has a weekly row that week'
      : alreadyPosted.has(weeklyId)
        ? 'already posted by this batch'
        : null;
    const whyChai =
      chai <= 0
        ? 'no tea on this run'
        : hasChai.has(id)
          ? 'already has a tea row that week'
          : alreadyPosted.has(chaiId)
            ? 'already posted by this batch'
            : null;
    return { member: m, weeklyId, chaiId, whyWeekly, whyChai };
  });

  const doWeekly = plan.filter((p) => !p.whyWeekly);
  const doChai = plan.filter((p) => !p.whyChai);
  const weeklyTotal = doWeekly.length * weekly;
  const chaiTotal = doChai.length * chai;

  console.log('\n  ' + 'MEMBER'.padEnd(24) + 'WEEKLY'.padStart(12) + 'TEA'.padStart(9) + '  NOTES');
  for (const p of plan) {
    console.log(
      '  ' +
        String(p.member.name).padEnd(24) +
        (p.whyWeekly ? '—' : money(weekly)).padStart(12) +
        (p.whyChai ? '—' : money(chai)).padStart(9) +
        '  ' +
        [p.whyWeekly, p.whyChai].filter(Boolean).join('; ')
    );
  }
  console.log(
    `\n${doWeekly.length} of ${members.length} member(s) to post: ${money(weeklyTotal)} contributions + ${money(
      chaiTotal
    )} tea = ${money(weeklyTotal + chaiTotal)} of cash.`
  );
  console.log(`per member: +${money(weekly)} paid, −${money(chai)} tea, so his money goes up by ${money(weekly - chai)}.`);

  if (doWeekly.length === 0 && doChai.length === 0) {
    console.log('\nNothing to post — every member already has this week.');
    await mongoose.disconnect();
    return;
  }
  if (!CONFIRMED) {
    console.log('\nDRY RUN — nothing written. Re-run with --confirm-write to post it.');
    await mongoose.disconnect();
    return;
  }

  const admin = await User.findOne({ role: 'super_admin' }).lean();
  if (!admin) {
    console.error('No super admin to attribute the entries to — aborting without writing.');
    process.exit(1);
  }

  let written = 0;
  for (const p of doWeekly) {
    await Contribution.create({
      memberId: p.member._id,
      typeId: types.weekly._id,
      amount: weekly,
      date: when,
      method,
      note: text,
      loggedBy: admin._id,
      clientRequestId: p.weeklyId,
    });
    written += 1;
  }
  for (const p of doChai) {
    await Contribution.create({
      memberId: p.member._id,
      typeId: types.chai._id,
      amount: chai,
      date: when,
      method,
      note: text,
      loggedBy: admin._id,
      clientRequestId: p.chaiId,
    });
    written += 1;
  }

  // One entry for the batch rather than 64 per-row entries, exactly as the API
  // does it: a group-wide action belongs to the System entity and the summary
  // carries the member ids and the totals, so the trail is whole.
  await logAudit({
    action: 'create',
    entityType: 'System',
    entityId: settings._id,
    performedBy: admin._id,
    after: {
      action: 'collect-week',
      script: 'src/scripts/postWeekCollection.js',
      weekNumber: week,
      date: when,
      members: members.length,
      posted: doWeekly.length,
      skipped: members.length - doWeekly.length,
      perMember: { weekly, chai },
      totals: { weekly: weeklyTotal, chai: chaiTotal, cash: weeklyTotal + chaiTotal },
      memberIds: doWeekly.map((p) => String(p.member._id)),
    },
  });

  console.log(`\nposted ${written} row(s) for week ${week}, dated ${day(when)}.`);
  console.log('Undo it any time with --undo --confirm-write, or the Undo button on the setup screen.');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('\nPOST FAILED:', err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
