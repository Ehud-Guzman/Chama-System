const JobRun = require('../models/JobRun');
const { listDefinitions, executeJob, findDefinition, jobsEnabled, LEASE_MS } = require('../jobs');
const { listBackups, backupDir, retentionCount } = require('../jobs/backupJob');
const { logAudit } = require('../utils/auditLogger');

// GET /api/jobs — what the scheduled jobs are, when they run next, and what they last did.
//
// This exists because the failure mode it guards against is an absence: a backup that stopped
// happening, a trail nobody is checking. An absence has no error message and no screen, so
// there is this one, and the settings screen shows it. The most recent runs are included so
// "it ran" can be read as a fact rather than inferred from a schedule.
async function jobStatus(req, res, next) {
  try {
    const definitions = listDefinitions();

    const runs = await JobRun.find({ name: { $in: definitions.map((d) => d.name) } })
      .sort({ startedAt: -1 })
      .limit(30)
      .lean();

    const byJob = {};
    for (const definition of definitions) {
      byJob[definition.name] = [];
    }
    for (const run of runs) {
      if (!byJob[run.name]) continue;
      if (byJob[run.name].length >= 5) continue;
      byJob[run.name].push({
        ok: run.ok,
        trigger: run.trigger,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
        summary: run.summary,
        error: run.error || null,
      });
    }

    // The backup directory, read from disk rather than from the job records: the point is
    // whether the files are actually there, so the files are what is listed.
    let backups = [];
    let backupsError = null;
    try {
      backups = listBackups(backupDir())
        .slice(-10)
        .reverse()
        .map((file) => ({
          name: file.name,
          sizeMb: Number((file.size / 1024 / 1024).toFixed(2)),
          writtenAt: new Date(file.mtimeMs).toISOString(),
        }));
    } catch (err) {
      // An unreadable or missing directory is itself the answer — it means no backup has ever
      // been written where this process expects to find one.
      backupsError = err.message;
    }

    res.json({
      enabled: jobsEnabled(),
      leaseMinutes: LEASE_MS / 60000,
      jobs: definitions.map((definition) => ({ ...definition, recentRuns: byJob[definition.name] || [] })),
      backups: {
        directory: backupDir(),
        retention: retentionCount(),
        files: backups,
        error: backupsError,
      },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/jobs/:name/run — run one now, by hand.
//
// The same code path as the timer, minus the timer, so a job that cannot be run by hand cannot
// be "known to work". The lease is still respected (not forced): pressing run twice must not
// produce two backups writing the same file.
async function runJobNow(req, res, next) {
  try {
    const definition = findDefinition(req.params.name);
    if (!definition) {
      return res.status(404).json({
        message: `No such job. Try one of: ${listDefinitions().map((job) => job.name).join(', ')}`,
      });
    }

    const result = await executeJob(definition, {
      trigger: 'manual',
      holder: `manual:${req.user.email}`,
    });

    if (result.skipped) {
      return res.status(409).json({ message: result.reason });
    }

    // A manual run is attributed twice on purpose: once in the job record (who pressed it) and
    // once in the audit trail (which is where "who did what" is read from).
    await logAudit({
      action: 'create',
      entityType: 'JobRun',
      entityId: req.user._id,
      performedBy: req.user._id,
      after: {
        action: 'job-run-by-hand',
        job: definition.name,
        ok: Boolean(result.ok),
        error: result.error || null,
        summary: result.summary || null,
      },
    });

    if (!result.ok) {
      return res.status(500).json({ ok: false, job: definition.name, error: result.error });
    }
    res.json({ ok: true, job: definition.name, summary: result.summary });
  } catch (err) {
    next(err);
  }
}

module.exports = { jobStatus, runJobNow };