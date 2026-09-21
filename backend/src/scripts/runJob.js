// Running one scheduled job from the command line.
//
// The same code the timer runs (jobs/index), so this is a rehearsal of the schedule rather than
// a second implementation of it. It exists for the two cases the HTTP endpoint cannot cover:
// a deployment where the API is not reachable, and a first run on a new host — where "does the
// backup actually write a file I can find?" is a question worth answering before trusting a
// timer to answer it at 2am.
//
//   npm run job:backup
//   npm run job:audit
//   npm run job:reminders
//   node src/scripts/runJob.js nightly-backup --force    # ignore another instance's lease
require('dotenv').config();

const mongoose = require('mongoose');
const { executeJob, findDefinition, listDefinitions } = require('../jobs');

async function main() {
  const [, , name, ...rest] = process.argv;
  const force = rest.includes('--force');

  if (!name) {
    console.error('\n  Which job? One of:\n');
    for (const job of listDefinitions()) {
      console.error(`    ${job.name.padEnd(18)} ${job.schedule.padEnd(22)} ${job.describe}`);
    }
    console.error('\n  e.g. node src/scripts/runJob.js nightly-backup\n');
    process.exit(2);
  }

  const definition = findDefinition(name);
  if (!definition) {
    console.error(`\n  There is no job called "${name}".\n`);
    process.exit(2);
  }

  if (!process.env.MONGO_URI) {
    console.error('\n  MONGO_URI is not set, so there is nothing to run against.\n');
    process.exit(1);
  }

  // A job writes into the same database the API uses, so this is one of the few scripts here
  // that is not a dry run — it is the real thing, by name, on purpose.
  mongoose.set('strictQuery', true);
  await mongoose.connect(process.env.MONGO_URI);

  console.log(`\n  Running ${name}…`);
  const result = await executeJob(definition, {
    trigger: 'manual',
    holder: `cli:${process.env.USERNAME || process.env.USER || 'shell'}`,
    force,
  });

  if (result.skipped) {
    console.log(`\n  Skipped: ${result.reason}`);
    console.log('  (Another instance holds the lease. Use --force to run it anyway.)\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  if (!result.ok) {
    console.error(`\n  ✗ ${name} failed: ${result.error}\n`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`\n  ✓ ${name} finished.`);
  console.log(JSON.stringify(result.summary, null, 2).replace(/^/gm, '  '));
  console.log('');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n  The job could not be run:', err.message, '\n');
  process.exit(1);
});
