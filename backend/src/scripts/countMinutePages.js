/**
 * Count the pages of every minute already on file.
 *
 * A minute's page count is worked out when the minute is written (utils/minutePages), so anything
 * saved from now on carries its own figure. This fills in the minutes saved *before* that existed —
 * `pages: null` — and, with --all, recounts the lot, which is what to run if the counting rule ever
 * changes (a different page size, a different body size, a different margin).
 *
 * WHAT IT DOES
 *
 *   1. lays out every minute that needs one and prints what it found — the count per minute, and
 *      how many minutes fall on each page count, so a strange batch is visible before it is written
 *   2. with --confirm-write: saves the counts and records one System audit entry carrying how many
 *      minutes were counted and what the total came to
 *
 * The number is a real layout of the real text, not an estimate: the same engine that would print
 * the minute (pdfkit, A4 at 12pt with one-inch margins) lays it out and reports how many pages it
 * needed. Expect roughly 10-30ms a minute.
 *
 * Usage:
 *
 *   Dry run (the default — writes nothing):
 *     node src/scripts/countMinutePages.js
 *
 *   Fill in the minutes that have never been counted:
 *     node src/scripts/countMinutePages.js --confirm-write
 *
 *   Recount every minute (after a change to the rule):
 *     node src/scripts/countMinutePages.js --all --confirm-write
 */
require('dotenv').config();

const mongoose = require('mongoose');

const Minute = require('../models/Minute');
const User = require('../models/User');
const { logAudit } = require('../utils/auditLogger');
const { countMinutePages } = require('../utils/minutePages');

const CONFIRMED = process.argv.includes('--confirm-write');
const ALL = process.argv.includes('--all');

function money(n) {
  return Number(n || 0).toLocaleString('en-KE');
}

(async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 45000 });

  // Everything live: a deleted minute is one nobody reads and nobody bills for, and recounting it
  // would only put a figure on a document that no longer exists to anybody.
  const filter = ALL ? { deleted: false } : { deleted: false, pages: null };
  const minutes = await Minute.find(filter).select('title date content pages').sort({ date: -1 }).lean();

  if (minutes.length === 0) {
    console.log(
      ALL
        ? '\nNo minutes on file to count.'
        : '\nEvery minute already carries a page count. Use --all to recount them.'
    );
    await mongoose.disconnect();
    return;
  }

  const found = new Map();
  let total = 0;
  const results = [];
  const started = Date.now();

  for (const minute of minutes) {
    const pages = countMinutePages(minute);
    results.push({ id: minute._id, title: minute.title, date: minute.date, was: minute.pages ?? null, pages });
    total += pages;
    found.set(pages, (found.get(pages) || 0) + 1);
    const changed = minute.pages !== pages;
    console.log(
      `${String(pages).padStart(3)} page(s)  ${changed ? '→' : ' '} ${
        minute.pages === null ? 'never counted' : `${minute.pages} before`
      }  ${new Date(minute.date).toISOString().slice(0, 10)}  ${minute.title}`
    );
  }

  console.log(
    `\n${minutes.length} minute(s) laid out in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      `${money(total)} page(s) in total.`
  );
  console.log(
    'By page count: ' +
      [...found.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([pages, count]) => `${pages} page${pages === 1 ? '' : 's'} × ${count}`)
        .join(', ')
  );

  if (!CONFIRMED) {
    console.log('\nDRY RUN — nothing written. Re-run with --confirm-write to save these counts.');
    await mongoose.disconnect();
    return;
  }

  let saved = 0;
  for (const row of results) {
    if (row.was === row.pages) continue;
    await Minute.updateOne({ _id: row.id }, { $set: { pages: row.pages } });
    saved += 1;
  }

  const admin = await User.findOne({ role: 'super_admin' }).lean();
  if (admin) {
    await logAudit({
      action: 'update',
      entityType: 'System',
      entityId: admin._id,
      performedBy: admin._id,
      before: {
        action: 'count-minute-pages',
        script: 'src/scripts/countMinutePages.js',
        recounted: ALL,
        counted: minutes.length,
        saved,
        pages: total,
      },
    });
  }

  console.log(`\nDone. ${saved} minute(s) updated, ${money(total)} page(s) counted.`);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('\nCOUNT FAILED:', err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
