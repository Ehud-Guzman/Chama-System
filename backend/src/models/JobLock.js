const { Schema, model } = require('mongoose');

// A lease, so a scheduled job runs once even when the app is running more than once.
//
// The timer lives in the process, and a host that restarts an instance, runs two of them for
// a minute during a deploy, or gets scaled to two by an afternoon of traffic would otherwise
// run the nightly backup twice — or email the whole group twice, which is the version
// members notice. The lock is the database, which is the one thing both instances share.
//
// It is a lease rather than a boolean: a process that dies mid-job must not leave the lock
// set forever, or the job never runs again. `lockedUntil` passing is the recovery, and a
// stale lease is safe to steal because the alternative — a backup that never happens again
// because a container was killed once — is worse than a duplicate.
//
// One row per job name, enforced by the unique index; there is no `_id` lookup anywhere.
const JobLockSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    lockedUntil: { type: Date, required: true },
    // Recorded so a stolen lease can say who took it.
    lockedBy: { type: String, default: '' },
    lastRunAt: { type: Date, default: null },
    lastOutcome: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = model('JobLock', JobLockSchema);
