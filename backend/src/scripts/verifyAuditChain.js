// Verifying the audit chain, from the command line.
//
// The point of the chain (utils/auditChain) is that the trail cannot be quietly
// rewritten. This is the other half of that: the thing you run to find out whether it has
// been. It reads, it never writes, and its exit code is the answer — 0 for intact, 1 for
// broken — so it can be run by hand after an incident, or on a schedule by whoever wants
// the alarm before the incident.
//
// Two things make it worth running on a rota rather than only when something looks wrong:
//
//   * `--head=<hash>` compares the trail's end against a hash you wrote down earlier (the
//     value this script prints). A chain proves nothing about entries removed from the
//     end, and the recorded head is what covers that.
//   * The `--since=` window means a long trail can be checked a month at a time without
//     pulling the whole collection into memory.
//
//   npm run verify:audit                     # whole chain, newest head printed
//   npm run verify:audit -- --since=2026-01-01
//   npm run verify:audit -- --head=<hash>    # against the value written down last month
require('dotenv').config();

const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const { verifyChain } = require('../utils/auditChain');

const BATCH = 2000;

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('\n  MONGO_URI is not set. Nothing to check.\n');
    process.exit(1);
  }

  const since = readArg('since');
  const expectedHead = readArg('head');
  const sinceDate = since ? new Date(since) : null;
  if (since && Number.isNaN(sinceDate.getTime())) {
    console.error(`\n  --since=${since} is not a date.\n`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const filter = { chainSequence: { $ne: null } };
  if (sinceDate) filter.createdAt = { $gte: sinceDate };

  const total = await AuditLog.countDocuments(filter);
  const unchained = await AuditLog.countDocuments({ chainSequence: null });

  console.log(`\n  Audit chain: ${total} chained entr${total === 1 ? 'y' : 'ies'} to check.`);
  if (unchained > 0) {
    console.log(
      `  ${unchained} older entr${unchained === 1 ? 'y' : 'ies'} predate the chain and are not checked —`
    );
    console.log('  they cannot be recomputed honestly, and are left as they are.');
  }
  if (total === 0) {
    console.log('\n  Nothing chained yet. Nothing to verify.\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Paged by sequence rather than skipped: the collection only grows, and a skip over a
  // million documents is a scan for every page.
  let cursor = null;
  let checked = 0;
  let broken = null;
  let head = null;
  let firstSequence = null;

  for (;;) {
    const query = filter;
    if (cursor !== null) query.chainSequence = { $ne: null, $gt: cursor };
    const batch = await AuditLog.find(query)
      .sort({ chainSequence: 1 })
      .limit(BATCH)
      .select('_id action entityType entityId performedBy before after createdAt prevHash hash chainSequence')
      .lean();

    if (batch.length === 0) break;

    const result = verifyChain(batch, {
      // Only the final batch is compared against the recorded head; the intermediate ones
      // are being checked for internal consistency.
      expectedHead: null,
    });
    if (!result.ok) {
      broken = result;
      break;
    }

    checked += batch.length;
    head = result.head;
    if (firstSequence === null) firstSequence = result.firstSequence;
    cursor = batch[batch.length - 1].chainSequence;
    process.stdout.write(`\r  Checked ${checked}/${total}…`);
    if (batch.length < BATCH) break;
  }

  process.stdout.write('\r');
  console.log(`  Checked ${checked} chained entr${checked === 1 ? 'y' : 'ies'}.`);

  if (broken) {
    console.log('\n  ✗ THE AUDIT TRAIL HAS BEEN TAMPERED WITH.\n');
    console.log(`    ${broken.message}`);
    console.log(`    Entry:     ${broken.id}`);
    console.log(`    Sequence:  ${broken.chainSequence ?? '(none)'}`);
    console.log(`    Problem:   ${broken.reason}\n`);
    console.log('    Anything after this point in the trail cannot be trusted either. Compare');
    console.log('    against the most recent backup and tell the committee before touching the');
    console.log('    database — the entries that are still good are evidence.\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  if (expectedHead && expectedHead !== head) {
    console.log('\n  ✗ The trail is internally consistent, but it does not end where it should.\n');
    console.log(`    Ends at:  ${head}`);
    console.log(`    Expected: ${expectedHead}\n`);
    console.log('    Entries have been removed from the end, or the chain was rebuilt from a\n');
    console.log('    backup older than the hash you are comparing against.\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('\n  ✓ Intact. Every entry still hashes to the value stored with it.');
  console.log(`    First chained entry: ${firstSequence}`);
  console.log(`    Chain head:          ${head}`);
  console.log('\n    Write the head down somewhere outside this database, with the date. That');
  console.log('    written value is what proves in a month that nothing was removed from the');
  console.log('    end of the trail — the one thing the chain cannot check by itself.\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n  The check itself failed:', err.message, '\n');
  process.exit(1);
});
