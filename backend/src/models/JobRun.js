const { Schema, model } = require('mongoose');

// What a scheduled job did, kept so that "the backup ran last night" is a fact rather than
// an assumption.
//
// The absence of a backup is the failure mode this whole file exists for, and an absence is
// invisible unless something records presence. A row per run — including the runs that
// failed, and the ones that decided there was nothing to do — makes the question "is the
// nightly backup actually happening?" answerable from the database instead of from the
// host's log retention window, which is usually shorter.
//
// It is also where the audit chain's head gets recorded on a schedule (see jobs/auditJob):
// a weekly hash written here, and emailed, is the anchor that catches entries removed from
// the end of the trail.
const JobRunSchema = new Schema(
  {
    // 'nightly-backup', 'audit-check', 'reminder-sweep'
    name: { type: String, required: true, index: true },
    // Why it ran. `schedule` is the timer; `manual` is somebody running the npm script or
    // the endpoint, which is the case worth being able to tell apart when a job's effect
    // needs explaining.
    trigger: { type: String, enum: ['schedule', 'manual', 'startup'], default: 'schedule' },
    ok: { type: Boolean, required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    durationMs: { type: Number, default: 0 },
    // Free-form and deliberately not a schema: what a job wants to report differs per job
    // (bytes written, members owing, chain head), and every one of them is read by a person
    // looking at a screen rather than by code.
    summary: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

// The screen that shows recent runs: newest first, per job.
JobRunSchema.index({ name: 1, startedAt: -1 });
// Retention: old run records are trimmed alongside the audit trail.
JobRunSchema.index({ startedAt: -1 });

module.exports = model('JobRun', JobRunSchema);
