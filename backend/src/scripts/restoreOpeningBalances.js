/**
 * Opening balances, put back — the undo for a go-live sheet that was filled in
 * wrongly.
 *
 * The mistake this exists for: `/admin/finance/setup` saves every member's
 * opening balance in one request, so one bad sheet — 32 boxes all reading 1400,
 * say — overwrites 32 verified paper-ledger figures at once, and nothing on the
 * screen can put them back. The figures are not lost, though: every write
 * through the API leaves a full before/after snapshot in the audit trail, so
 * each member's previous figure can be read straight back out of it.
 *
 * WHAT IT DOES
 *
 *   1. works out the figure to restore for each member:
 *        (default)        the value the newest save overwrote — an exact undo
 *        --as-of=<time>   the value that stood at that moment — step further back
 *        --from-backup=   the roll-forward recomputed from a `reset-backup-*.json`
 *                         file, i.e. what the imported ledger itself said
 *   2. prints every member: what he holds now, what he would hold, and why
 *   3. with --confirm-write: backs the members up to backend/data/, writes the
 *      figures, and audit-logs each one — so this undo can itself be undone
 *
 * Nothing is written without --confirm-write, and a member whose figure is
 * already right is left alone.
 *
 * Usage:
 *
 *   Dry run (the default — writes nothing, prints the whole plan):
 *     node src/scripts/restoreOpeningBalances.js
 *
 *   Apply the undo:
 *     node src/scripts/restoreOpeningBalances.js --confirm-write
 *
 *   Step back to an earlier moment, or to the ledger's own figures:
 *     node src/scripts/restoreOpeningBalances.js --as-of=2026-09-17T16:00:00Z
 *     node src/scripts/restoreOpeningBalances.js --from-backup=data/reset-backup-2026-09-17T12-24-29-752Z.json
 *
 *   One member only (case-insensitive part of his name):
 *     node src/scripts/restoreOpeningBalances.js --member=evans
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Member = require('../models/Member');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { logAudit, snapshot } = require('../utils/auditLogger');

const CONFIRMED = process.argv.includes('--confirm-write');

// Reads `--flag=value`, or null when the flag is absent or given without a value.
function argValue(flag) {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit || !hit.includes('=')) return null;
  const value = hit.slice(hit.indexOf('=') + 1).trim();
  return value === '' ? null : value;
}

const AS_OF = argValue('--as-of');
const FROM_BACKUP = argValue('--from-backup');
const NAME_FILTER = argValue('--member');

const money = (n) => 'Ksh ' + Number(n || 0).toLocaleString('en-KE');
const fmt = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '-');
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Finds a backup file whether the path is given relative to the repo root or to
// backend/, so both `data/reset-backup-….json` and the full path work.
function resolveBackup(given) {
  const tries = [path.resolve(process.cwd(), given), path.resolve(__dirname, '../..', given)];
  for (const p of tries) if (fs.existsSync(p)) return p;
  throw new Error(`No such backup file: ${given}`);
}

// Each member's figure as the imported ledger had it, from a reset backup: his
// own rows only, group funds excluded, grossAmount preferred over amount —
// exactly the rule `suggestedOpeningBalances()` uses on live data.
function figuresFromBackup(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cols = data.collections || {};
  const types = cols.contributiontypes || [];
  const groupTypeIds = new Set(types.filter((t) => t.isGroupFund).map((t) => String(t._id)));
  const held = new Map();
  for (const c of cols.contributions || []) {
    if (c.deleted) continue;
    if (groupTypeIds.has(String(c.typeId))) continue;
    const key = String(c.memberId);
    held.set(key, (held.get(key) || 0) + Number(c.grossAmount ?? c.amount ?? 0));
  }
  for (const [key, value] of held) held.set(key, round2(value));
  return { held, takenAt: data.takenAt || null, rows: (cols.contributions || []).length };
}

// What each member's balance stood at, read from the audit trail. Two ways of
// asking the same history: "put back what the last save took away" (the default)
// and "what did it read at this moment".
async function figuresFromAudit(members) {
  const rows = await AuditLog.find({ entityType: 'Member', action: 'update' })
    .sort({ createdAt: -1 })
    .lean();
  const changed = rows.filter(
    (r) =>
      (r.before?.openingBalance || 0) !== (r.after?.openingBalance || 0) &&
      // A restore is not "the newest save": if it counted as one, running this
      // script a second time would dutifully put the mistake back. What a restore
      // wrote is still on the record, marker and all, for anybody reading the
      // Reports → Audit trail page.
      !r.after?.restoredBy
  );
  const byMember = new Map();
  for (const r of changed) {
    const key = String(r.entityId);
    if (!byMember.has(key)) byMember.set(key, []);
    byMember.get(key).push(r);
  }

  let asOf = null;
  if (AS_OF) {
    asOf = new Date(AS_OF);
    if (Number.isNaN(asOf.getTime())) throw new Error(`--as-of=${AS_OF} is not a date`);
  }

  const planned = new Map();
  for (const m of members) {
    const history = byMember.get(String(m._id)) || [];
    if (history.length === 0) continue; // nothing recorded: never guessed at
    if (asOf) {
      const atOrBefore = history.find((r) => new Date(r.createdAt) <= asOf);
      if (atOrBefore) {
        planned.set(String(m._id), {
          amount: round2(atOrBefore.after?.openingBalance || 0),
          source: `as at ${fmt(asOf)}`,
        });
      } else {
        const oldest = history[history.length - 1];
        planned.set(String(m._id), {
          amount: round2(oldest.before?.openingBalance || 0),
          source: `before ${fmt(oldest.createdAt)} (earliest on record)`,
        });
      }
      continue;
    }
    const newest = history[0];
    planned.set(String(m._id), {
      amount: round2(newest.before?.openingBalance || 0),
      source: `undo of the ${fmt(newest.createdAt)} save`,
    });
  }
  return { planned, changes: changed.length, first: changed[changed.length - 1], last: changed[0] };
}


(async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);

  const all = await Member.find().sort({ name: 1 }).lean();
  const members = NAME_FILTER
    ? all.filter((m) => String(m.name).toLowerCase().includes(NAME_FILTER.toLowerCase()))
    : all;
  if (members.length === 0) {
    console.error(NAME_FILTER ? `No member matches --member=${NAME_FILTER}` : 'No members found.');
    process.exit(1);
  }
  console.log(`\nmembers in this plan: ${members.length} of ${all.length}`);

  let planned;
  let sourceLabel;
  if (FROM_BACKUP) {
    const file = resolveBackup(FROM_BACKUP);
    const { held, takenAt, rows } = figuresFromBackup(file);
    console.log(
      `source: the imported ledger in ${path.basename(file)} (taken ${fmt(takenAt)}, ${rows} rows)`
    );
    sourceLabel = 'the ledger\u2019s own roll-forward';
    planned = new Map(
      members.map((m) => [
        String(m._id),
        { amount: round2(held.get(String(m._id)) || 0), source: 'ledger rows' },
      ])
    );
  } else {
    const audit = await figuresFromAudit(members);
    console.log(
      `source: the audit trail — ${audit.changes} opening-balance changes on record, ` +
        `${fmt(audit.first?.createdAt)} through ${fmt(audit.last?.createdAt)}`
    );
    if (AS_OF) console.log(`(reading the history as it stood at ${fmt(new Date(AS_OF))})`);
    sourceLabel = AS_OF
      ? `the figures as at ${fmt(new Date(AS_OF))}`
      : 'an exact undo of the newest save';
    planned = audit.planned;
  }

  // The plan, member by member. Only the rows that would actually change are
  // listed as work; the rest are printed as already-correct so nobody wonders
  // whether anyone was forgotten.
  const work = [];
  let totalNow = 0;
  let totalAfter = 0;
  console.log(`\n${sourceLabel}\n`);
  console.log('  ' + 'MEMBER'.padEnd(24) + 'NOW'.padStart(15) + 'AFTER'.padStart(15) + '  WHY');
  for (const m of members) {
    const plan = planned.get(String(m._id));
    const now = round2(m.openingBalance || 0);
    totalNow += now;
    if (!plan) {
      console.log('  ' + String(m.name).padEnd(24) + money(now).padStart(15) + '        (none)' + '  nothing on record — left alone');
      continue;
    }
    totalAfter += plan.amount;
    const differs = now !== plan.amount;
    if (differs) work.push({ member: m, amount: plan.amount, now });
    console.log(
      '  ' +
        String(m.name).padEnd(24) +
        money(now).padStart(15) +
        money(plan.amount).padStart(15) +
        '  ' +
        plan.source +
        (differs ? '' : ' (already right)')
    );
  }
  console.log(
    '\n  ' + 'TOTALS'.padEnd(24) + money(totalNow).padStart(15) + money(totalAfter).padStart(15)
  );
  console.log(`\n${work.length} member(s) would change.`);

  // An undo of a mistake nearly always lowers the total, and so does undoing the
  // undo — the two look identical in the table above, so the direction is called
  // out in words and the WHY column is what tells them apart.
  if (totalAfter < totalNow) {
    const pct = totalNow > 0 ? Math.round(((totalNow - totalAfter) / totalNow) * 100) : 0;
    console.log(
      `\nNOTE: this LOWERS the members' total by ${pct}% — ${money(totalNow)} becomes ${money(
        totalAfter
      )}.\n      Check the WHY column: an undo of a mistaken save reads "undo of the <time> save".`
    );
  }

  if (work.length === 0) {
    console.log('Nothing to do — every figure already reads as planned.');
    await mongoose.disconnect();
    return;
  }

  if (!CONFIRMED) {
    console.log('\nDRY RUN — nothing written. Re-run with --confirm-write to apply.');
    await mongoose.disconnect();
    return;
  }

  // A full copy of the members as they stand, before a single figure moves: the
  // same promise `reset:week92` makes, and the reason a wrong undo is survivable.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.resolve(__dirname, '../../data', `opening-balances-${stamp}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify({ takenAt: new Date().toISOString(), members: all }));
  console.log(`\nbackup written: ${backupPath}`);

  const admin = await User.findOne({ role: 'super_admin' }).lean();
  if (!admin) {
    console.error('No super admin to attribute the change to — aborting without writing.');
    process.exit(1);
  }

  let written = 0;
  for (const row of work) {
    const before = await Member.findById(row.member._id).lean();
    const updated = await Member.findByIdAndUpdate(
      row.member._id,
      { $set: { openingBalance: row.amount } },
      { new: true }
    );
    written += 1;
    await logAudit({
      action: 'update',
      entityType: 'Member',
      entityId: updated._id,
      performedBy: admin._id,
      before,
      // Marked so this script can tell its own repair apart from a save made from
      // the setup screen — see the filter in figuresFromAudit().
      after: { ...snapshot(updated), restoredBy: 'src/scripts/restoreOpeningBalances.js' },
    });
  }
  console.log(`\nrestored ${written} opening balance(s).`);
  console.log(
    `total now: ${money(
      members.reduce(
        (s, m) => s + (planned.get(String(m._id))?.amount ?? round2(m.openingBalance || 0)),
        0
      )
    )}`
  );
  console.log('\nOpen /admin/finance/setup — the boxes should read the restored figures — then');
  console.log('repost the week-91 collection if the members\u2019 money still looks short.');
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('\nRESTORE FAILED:', err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
