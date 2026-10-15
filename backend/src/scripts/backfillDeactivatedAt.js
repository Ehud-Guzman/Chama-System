// Gives every inactive member the day he was made inactive, so his accounting stops on it.
//
//   npm run members:backfill-inactive             # shows what it would do, writes nothing
//   npm run members:backfill-inactive -- --apply  # does it
//
// The same fill runs by itself when the server starts, so this is for looking first. It reads the
// exact day from the audit trail where it can (utils/backfillDeactivatedAt) and never changes a date
// that is already there.
require('dotenv').config();
const mongoose = require('mongoose');
const { backfillDeactivatedAt } = require('../utils/backfillDeactivatedAt');

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGO_URI);
  const result = await backfillDeactivatedAt({ dryRun: !apply });

  console.log(`${result.checked} inactive member(s) have no recorded day of leaving.`);
  for (const row of result.filled) {
    console.log(`  ${String(row.name).padEnd(28)} ${new Date(row.at).toISOString().slice(0, 10)}  (from the ${row.from})`);
  }
  console.log(apply ? `\nSet ${result.filled.length}.` : '\nNothing written. Add --apply to set them.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
