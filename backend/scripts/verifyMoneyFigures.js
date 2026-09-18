#!/usr/bin/env node
/**
 * Read-only check: does anything already in the database disagree with the rules
 * the API now enforces on write?
 *
 * This exists to answer one question honestly — "will these changes alter my
 * figures?" — before anyone deploys them. It writes nothing. `autoIndex` is
 * switched off deliberately, so running it does not even build an index.
 *
 *   node scripts/verifyMoneyFigures.js
 *
 * What it looks for:
 *
 *   1. money stored with more than two decimal places. These are the only values
 *      the new rounding could ever touch, and only if that document is written
 *      again (a settle, an edit, a re-save). Anything whole is untouched for ever.
 *   2. money outside the new bounds (negative, or past Ksh 1bn). A document that
 *      already breaks a validator would refuse to save the next time somebody
 *      edits it, which is worth knowing before a treasurer hits it.
 *   3. free text longer than a new maxlength, same reasoning.
 *   4. duplicates in national IDs (the new partial unique index cannot build), and
 *      how many Settings rows exist (there must be exactly one).
 *   5. the books as they stand, so the same numbers can be compared after a deploy.
 */
require('dotenv').config();

const mongoose = require('mongoose');

// No index builds: this script must not change the database in any way.
mongoose.set('autoIndex', false);

const MONEY_MAX = 1_000_000_000;

// Every money field the API now rounds on write.
const MONEY_FIELDS = [
  ['members', ['openingBalance']],
  ['contributions', ['amount', 'grossAmount', 'fineDeducted']],
  ['contributiontypes', ['weeklyAmount', 'openingBalance']],
  ['expenses', ['amount']],
  ['fines', ['amount', 'remaining']],
];

const TEXT_LIMITS = [
  ['minutes', 'title', 200],
  ['minutes', 'content', 200000],
  ['members', 'notes', 2000],
  ['contributions', 'note', 2000],
  ['expenses', 'note', 2000],
  ['expenses', 'description', 500],
  ['fines', 'reason', 500],
  ['chamadocuments', 'title', 200],
  ['chamadocuments', 'description', 1000],
  ['contributiontypes', 'name', 80],
  ['contributiontypes', 'description', 500],
  ['contributiontypes', 'openingBalanceNote', 240],
];

function money(value) {
  return 'Ksh ' + Number(value || 0).toLocaleString('en-KE');
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set — nothing to check.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  console.log(`Read-only check of "${db.databaseName}" — nothing will be written.\n`);

  let drift = 0;
  let outOfBounds = 0;
  let tooLong = 0;

  console.log('== money: stored with more than two decimal places ==');
  for (const [collection, fields] of MONEY_FIELDS) {
    for (const field of fields) {
      // `$round` of a missing or null field is null, which the `$ne` below reads as
      // "not rounded" — so a field that simply does not exist has to be excluded
      // explicitly. (A fund type with no carried-in balance has no such field.)
      const filter = {
        [field]: { $ne: null, $exists: true, $not: { $type: 'date' } },
        $expr: { $ne: [{ $round: [`$${field}`, 2] }, `$${field}`] },
      };
      const rounded = await db.collection(collection).countDocuments(filter);
      if (rounded > 0) {
        const sample = await db
          .collection(collection)
          .find(filter)
          .project({ [field]: 1 })
          .limit(5)
          .toArray();
        console.log(
          `  ${collection}.${field}: ${rounded} need rounding (e.g. ${sample
            .map((doc) => JSON.stringify(doc[field]))
            .join(', ')})`
        );
      }
      drift += rounded;
    }
  }
  if (drift === 0) console.log('  none — every stored amount is already a whole or 2-dp figure');

  console.log('\n== money: outside the new bounds ==');
  for (const [collection, fields] of MONEY_FIELDS) {
    for (const field of fields) {
      const negative = await db.collection(collection).countDocuments({ [field]: { $lt: 0 } });
      const huge = await db.collection(collection).countDocuments({ [field]: { $gte: MONEY_MAX } });
      if (negative || huge) {
        console.log(
          `  ${collection}.${field}: ${negative} negative, ${huge} at Ksh 1bn or more — these documents would refuse to save`
        );
        outOfBounds += negative + huge;
      }
    }
  }
  if (outOfBounds === 0) console.log('  none');

  console.log('\n== money: stored as something other than a number ==');
  for (const [collection, fields] of MONEY_FIELDS) {
    for (const field of fields) {
      const filter = { [field]: { $exists: true, $not: { $type: 'number' } } };
      const odd = await db.collection(collection).countDocuments(filter);
      if (odd > 0) {
        const sample = await db
          .collection(collection)
          .aggregate([
            { $match: filter },
            { $project: { name: 1, value: `$${field}`, storedType: { $type: `$${field}` } } },
            { $limit: 5 },
          ])
          .toArray();
        console.log(`  ${collection}.${field}: ${odd} not a number`);
        for (const row of sample) {
          console.log(`    ${row.name || '(no name)'}: ${JSON.stringify(row.value)} (${row.storedType})`);
        }
        outOfBounds += odd;
      }
    }
  }
  if (outOfBounds === 0) console.log('  none');

  console.log('\n== free text: longer than the new cap ==');
  for (const [collection, field, limit] of TEXT_LIMITS) {
    const over = await db
      .collection(collection)
      .countDocuments({
        $expr: { $gt: [{ $strLenCP: { $ifNull: [`$${field}`, ''] } }, limit] },
      });
    if (over) {
      console.log(`  ${collection}.${field}: ${over} over ${limit} characters — would refuse to save`);
      tooLong += over;
    }
  }
  if (tooLong === 0) console.log('  none');

  console.log('\n== identity and singletons ==');
  const duplicateIds = await db
    .collection('members')
    .aggregate([
      { $match: { nationalId: { $type: 'string', $gt: '' } } },
      { $group: { _id: '$nationalId', n: { $sum: 1 }, names: { $push: '$name' } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();
  if (duplicateIds.length === 0) {
    console.log('  national IDs: no duplicates — the unique index will build');
  } else {
    console.log(`  national IDs: ${duplicateIds.length} duplicated value(s) — index will NOT build:`);
    for (const row of duplicateIds) console.log(`    ${row._id} → ${row.names.join(', ')}`);
  }

  const settingsRows = await db.collection('settings').countDocuments();
  console.log(
    `  settings rows: ${settingsRows}${settingsRows === 1 ? ' (correct)' : ' — expected exactly 1'}`
  );

  console.log('\n== the books as they stand (compare these after a deploy) ==');
  const [memberRows, contributions, expenses, fines] = await Promise.all([
    db.collection('members').find({}).project({ name: 1, openingBalance: 1 }).toArray(),
    db
      .collection('contributions')
      .aggregate([
        { $match: { deleted: false } },
        {
          $group: {
            _id: null,
            rows: { $sum: 1 },
            net: { $sum: '$amount' },
            cash: { $sum: { $ifNull: ['$grossAmount', '$amount'] } },
            toFines: { $sum: { $ifNull: ['$fineDeducted', 0] } },
          },
        },
      ])
      .toArray(),
    db
      .collection('expenses')
      .aggregate([
        { $match: { deleted: false } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ])
      .toArray(),
    db
      .collection('fines')
      .aggregate([
        { $match: { deleted: false } },
        { $group: { _id: null, issued: { $sum: '$amount' }, outstanding: { $sum: '$remaining' } } },
      ])
      .toArray(),
  ]);

  const openingTotal = memberRows.reduce((sum, m) => sum + (Number(m.openingBalance) || 0), 0);
  const c = contributions[0] || { rows: 0, net: 0, cash: 0, toFines: 0 };
  console.log(`  members                  ${memberRows.length}`);
  console.log(`  opening balances total   ${money(openingTotal)}`);
  console.log(`  contribution rows        ${c.rows}`);
  console.log(`  contributions (amount)   ${money(c.net)}`);
  console.log(`  contributions (cash in)  ${money(c.cash)}`);
  console.log(`  already applied to fines ${money(c.toFines)}`);
  console.log(`  expenses (net of voids)  ${money(expenses[0]?.total || 0)}`);
  console.log(`  fines issued             ${money(fines[0]?.issued || 0)}`);
  console.log(`  fines outstanding        ${money(fines[0]?.outstanding || 0)}`);

  console.log('\n== summary ==');
  console.log(`  values the new rounding would touch:        ${drift}`);
  console.log(`  documents that would fail the new bounds:   ${outOfBounds}`);
  console.log(`  documents that would fail the new caps:     ${tooLong}`);
  console.log(`  duplicate national IDs:                     ${duplicateIds.length}`);
  if (drift === 0 && outOfBounds === 0 && tooLong === 0 && duplicateIds.length === 0) {
    console.log('\n  Nothing already stored disagrees with the new rules — no figure changes.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nCheck failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

