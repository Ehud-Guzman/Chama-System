// The job runner.
//
// One timer, one chain, no dependency. A cron library would do the same thing with a parser
// this system does not need (utils/jobSchedule reads the three schedules a chama actually
// wants) and another package to keep patched.
//
// Three things here are worth knowing before changing anything:
//
//   **It is off unless asked for.** `JOBS_ENABLED=false` switches the whole timer off, and the
//   test suite sets it. Nothing about importing this module starts a timer.
//
//   **A job runs once, even with two instances.** The lease in the database (models/JobLock) is
//   what makes that true; the timer alone would happily run the nightly backup twice during a
//   deploy that briefly has two instances. The lease expires, so a process killed mid-job does
//   not stop the job forever.
//
//   **A failing job never takes the process down.** Every run is wrapped and recorded in JobRun
//   — including the failures, because the absence of a backup is the thing being guarded
//   against, and an absence is invisible without a record of presence. A job that throws and
//   kills the API is worse than a job that did not run.
const JobRun = require('../models/JobRun');
const JobLock = require('../models/JobLock');
const { parseSchedule, nextRunAt, describeGap } = require('../utils/jobSchedule');
const { logEvent } = require('../middleware/requestLogger');

const { runBackupJob } = require('./backupJob');
const { runAuditJob } = require('./auditJob');
const { runReminderJob } = require('./reminderJob');

// How long a lease is held. Generous relative to the work — the nightly backup on a database
// this size is seconds — and it stays in minutes either way: the cost of a lease that is too
// short is a duplicate run, and the cost of one that is too long is a job that stops happening.
const LEASE_MS = 15 * 60 * 1000;

const DEFINITIONS = [
  {
    name: 'nightly-backup',
    // 02:00 EAT: after the Thursday collection has been logged, and long before anybody is
    // using the books.
    schedule: () => process.env.JOB_BACKUP_SCHEDULE || 'daily@02:00',
    run: () => runBackupJob({ trigger: 'schedule' }),
    describe: 'Writes the whole database to a backup file, and keeps the newest few.',
  },
  {
    name: 'audit-check',
    // Weekly on a Saturday: a week is short enough that a break in the trail is found while the
    // people who could have caused it are still around.
    schedule: () => process.env.JOB_AUDIT_SCHEDULE || 'weekly@sat@04:00',
    run: () => runAuditJob({ trigger: 'schedule' }),
    describe: 'Verifies the audit trail, records its head, and emails it out.',
  },
  {
    name: 'reminder-sweep',
    // Sunday evening, before the week starts: a member who has been meaning to catch up has the
    // next day to do it.
    schedule: () => process.env.JOB_REMINDER_SCHEDULE || 'weekly@sun@18:00',
    run: () => runReminderJob({ trigger: 'schedule' }),
    describe: 'Works out who is behind and reports it; emails them only if switched on.',
  },
];

let timer = null;
let stopped = false;

function jobsEnabled() {
  return String(process.env.JOBS_ENABLED || 'true').toLowerCase() !== 'false';
}

// Takes the lease for one run, or reports that somebody else holds it.
//
// Insert-then-steal, because that is the only shape that is safe with two writers: a plain
// read-then-write would let both instances see "no lock" and both proceed. The unique index on
// `name` makes the insert the arbiter, and a lease whose `lockedUntil` has passed is claimable
// by whoever gets there first.
async function acquireLease(name, holder) {
  const until = new Date(Date.now() + LEASE_MS);
  try {
    await JobLock.create({ name, lockedUntil: until, lockedBy: holder });
    return true;
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const stolen = await JobLock.findOneAndUpdate(
      { name, lockedUntil: { $lt: new Date() } },
      { $set: { lockedUntil: until, lockedBy: holder } }
    );
    return Boolean(stolen);
  }
}

async function releaseLease(name, outcome) {
  try {
    await JobLock.updateOne(
      { name },
      { $set: { lockedUntil: new Date(), lastRunAt: new Date(), lastOutcome: outcome } }
    );
  } catch (err) {
    // Not worth failing the run over: the lease expires on its own.
    logEvent('job_lease_release_failed', { name, error: err.message }, 'warn');
  }
}

// Runs one job and records it, whether it worked or not.
//
// `trigger` distinguishes the timer from somebody pressing run by hand, which is the difference
// between "the backup is failing every night" and "somebody tried it once and it failed".
async function executeJob(definition, { trigger = 'schedule', holder = 'unknown', force = false } = {}) {
  const name = definition.name;
  const startedAt = new Date();

  if (!force) {
    const acquired = await acquireLease(name, holder);
    if (!acquired) {
      logEvent('job_skipped_lease_held', { job: name, holder });
      return { skipped: true, reason: 'Another instance is running this job.' };
    }
  }

  try {
    const summary = await definition.run();
    const finishedAt = new Date();
    await JobRun.create({
      name,
      trigger,
      ok: true,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      summary,
    });
    if (!force) await releaseLease(name, 'ok');
    logEvent('job_ok', { job: name, trigger, ms: finishedAt - startedAt });
    return { ok: true, summary };
  } catch (err) {
    const finishedAt = new Date();
    // A failed run is the record that matters most, so the write of it is attempted even if the
    // failure was the database — and swallowed if it cannot be written either, because losing
    // the record must not become a second failure.
    await JobRun.create({
      name,
      trigger,
      ok: false,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      error: err.message,
    }).catch(() => {});
    if (!force) await releaseLease(name, `failed: ${err.message}`);
    logEvent('job_failed', { job: name, trigger, error: err.message }, 'error');
    return { ok: false, error: err.message };
  }
}

function findDefinition(name) {
  return DEFINITIONS.find((definition) => definition.name === name) || null;
}

// The schedules, as objects, with the next run worked out. Used by the status endpoint and by
// the screen that answers "are the backups actually happening?".
function listDefinitions(now = Date.now()) {
  return DEFINITIONS.map((definition) => {
    let nextRun = null;
    let error = null;
    try {
      nextRun = nextRunAt(parseSchedule(definition.schedule()), now);
    } catch (err) {
      // A misconfigured schedule must not stop the app starting — but it must be visible, because
      // the job it belongs to is silently not running otherwise.
      error = err.message;
      logEvent('job_schedule_invalid', { job: definition.name, error: err.message }, 'error');
    }
    return {
      name: definition.name,
      schedule: definition.schedule(),
      describe: definition.describe,
      enabled: jobsEnabled(),
      nextRunAt: nextRun ? new Date(nextRun).toISOString() : null,
      nextRunIn: nextRun ? describeGap(nextRun - now) : null,
      error,
    };
  });
}

// One timer, chained: each run asks for the next one after it finishes.
//
// A single `setInterval` for everything would be simpler and wrong — two jobs due in the same
// minute would overlap, and an interval keeps firing while the previous run is still going.
// Chaining means the schedule drifts by the duration of a run (seconds), which is the right
// trade for never having two of the same job in flight.
function scheduleNext(holder) {
  if (stopped || !jobsEnabled()) return;

  const pending = DEFINITIONS.map((definition) => {
    try {
      return { definition, at: nextRunAt(parseSchedule(definition.schedule())) };
    } catch {
      return null; // reported by listDefinitions; not a reason to stop the timer
    }
  }).filter(Boolean);

  if (pending.length === 0) return;

  pending.sort((a, b) => a.at - b.at);
  const next = pending[0];
  // setTimeout's ceiling is about 24 days, and a delay past it wraps and fires immediately.
  // Nothing here is scheduled that far out, but clamping is cheaper than explaining the bug.
  const delay = Math.max(1000, Math.min(next.at - Date.now(), 20 * 24 * 3600 * 1000));

  timer = setTimeout(async () => {
    await executeJob(next.definition, { trigger: 'schedule', holder });
    scheduleNext(holder);
  }, delay);
  timer.unref?.();

  logEvent('job_scheduled', {
    job: next.definition.name,
    at: new Date(next.at).toISOString(),
    in: describeGap(delay),
  });
}

function startJobs({ holder = `pid-${process.pid}` } = {}) {
  if (timer || stopped) return;
  if (!jobsEnabled()) {
    logEvent('jobs_disabled');
    return;
  }
  scheduleNext(holder);
}

function stopJobs() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = {
  DEFINITIONS,
  LEASE_MS,
  jobsEnabled,
  startJobs,
  stopJobs,
  executeJob,
  findDefinition,
  listDefinitions,
  acquireLease,
  releaseLease,
};
