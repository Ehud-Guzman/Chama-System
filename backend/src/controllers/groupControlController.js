const AuditLog = require('../models/AuditLog');
const AuditReview = require('../models/AuditReview');
const JobRun = require('../models/JobRun');
const { getOrCreateSettings, invalidateSettings } = require('../utils/settings');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { readAuditEntry } = require('../utils/auditFlags');
const { findDefinition, listDefinitions } = require('../jobs');
const { parseEatDate, toEatDateString } = require('../utils/weekCycle');
const { controlsOf } = require('./controlRoomController');

// The group-wide levers only the super admin holds: maintenance mode, closing the books, the
// feature switches, pausing a job — and the audit powers above the ordinary trail (the raw
// entry, flagging one for review, downloading the whole thing).
//
// Each lever writes a Settings audit entry carrying just the fields it moved, so the trail reads
// "maintenance mode: off → on" rather than a snapshot of the whole settings document.

const SWITCH_FIELDS = [
  'membersAreaEnabled',
  'fineEmailsEnabled',
  'reminderEmailsEnabled',
  'constitutionVotingEnabled',
];

async function saveAndAudit(settings, before, req) {
  settings.updatedBy = req.user._id;
  try {
    await settings.save();
  } catch (err) {
    // `settings` is the process-wide cached document, already changed in memory. Left there, every
    // guard would act on a value that was never saved until the cache expired.
    invalidateSettings();
    throw err;
  }
  invalidateSettings();
  await logAudit({
    action: 'update',
    entityType: 'Settings',
    entityId: settings._id,
    performedBy: req.user._id,
    before,
    after: pick(snapshot(settings), Object.keys(before)),
  });
}

function pick(object, keys) {
  const out = {};
  for (const key of keys) out[key] = object?.[key];
  return out;
}

// PUT /api/superadmin/maintenance { enabled, message }
async function setMaintenance(req, res, next) {
  try {
    const { enabled, message } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: 'enabled must be true or false' });
    }
    const text = String(message || '').trim().slice(0, 300);
    const settings = await getOrCreateSettings();
    const before = pick(snapshot(settings), ['maintenanceMode', 'maintenanceMessage']);
    settings.maintenanceMode = enabled;
    settings.maintenanceMessage = enabled ? text : '';
    settings.maintenanceSince = enabled ? settings.maintenanceSince || new Date() : null;
    await saveAndAudit(settings, before, req);
    res.json({ controls: controlsOf(settings) });
  } catch (err) {
    next(err);
  }
}

// PUT /api/superadmin/lock { lockedThrough: 'YYYY-MM-DD' | null, reason }
async function setLock(req, res, next) {
  try {
    const { lockedThrough, reason } = req.body || {};
    const settings = await getOrCreateSettings();
    const before = pick(snapshot(settings), ['lockedThrough', 'lockReason']);

    if (lockedThrough === null || lockedThrough === '' || lockedThrough === undefined) {
      settings.lockedThrough = null;
      settings.lockReason = '';
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(lockedThrough))) {
        return res.status(400).json({ message: 'Give the last day to close as YYYY-MM-DD.' });
      }
      const day = parseEatDate(String(lockedThrough));
      if (Number.isNaN(day.getTime())) {
        return res.status(400).json({ message: 'That is not a real date.' });
      }
      // Closing a day that has not happened would lock today's own entries, which is never the
      // intent. The latest day that can be closed is yesterday.
      const today = parseEatDate(toEatDateString(new Date()));
      if (day.getTime() >= today.getTime()) {
        return res.status(400).json({ message: 'You can only close days that have already ended — yesterday at the latest.' });
      }
      const why = String(reason || '').trim().slice(0, 300);
      if (why.length < 3) {
        return res.status(400).json({ message: 'Say why the books are being closed — it is shown to anyone who is stopped by it.' });
      }
      settings.lockedThrough = day;
      settings.lockReason = why;
    }
    await saveAndAudit(settings, before, req);
    res.json({ controls: controlsOf(settings) });
  } catch (err) {
    next(err);
  }
}

// PUT /api/superadmin/switches { membersAreaEnabled?, fineEmailsEnabled?, ... }
async function setSwitches(req, res, next) {
  try {
    const body = req.body || {};
    const given = SWITCH_FIELDS.filter((field) => body[field] !== undefined);
    if (given.length === 0) {
      return res.status(400).json({ message: `Send at least one of: ${SWITCH_FIELDS.join(', ')}` });
    }
    for (const field of given) {
      if (typeof body[field] !== 'boolean') {
        return res.status(400).json({ message: `${field} must be true or false` });
      }
    }
    const settings = await getOrCreateSettings();
    const before = pick(snapshot(settings), given);
    for (const field of given) settings[field] = body[field];
    await saveAndAudit(settings, before, req);
    res.json({ controls: controlsOf(settings) });
  } catch (err) {
    next(err);
  }
}

// PUT /api/superadmin/jobs/:name { paused }
async function setJobPaused(req, res, next) {
  try {
    const definition = findDefinition(req.params.name);
    if (!definition) {
      return res.status(404).json({
        message: `No such job. Try one of: ${listDefinitions().map((job) => job.name).join(', ')}`,
      });
    }
    if (typeof req.body?.paused !== 'boolean') {
      return res.status(400).json({ message: 'paused must be true or false' });
    }
    const settings = await getOrCreateSettings();
    const before = { pausedJobs: [...(settings.pausedJobs || [])] };
    const set = new Set(before.pausedJobs);
    if (req.body.paused) set.add(definition.name);
    else set.delete(definition.name);
    settings.pausedJobs = [...set];
    await saveAndAudit(settings, before, req);
    res.json({ controls: controlsOf(settings) });
  } catch (err) {
    next(err);
  }
}

// GET /api/superadmin/jobs/history?name=&limit=
async function jobHistory(req, res, next) {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 40));
    const filter = {};
    if (req.query.name) filter.name = String(req.query.name);
    const runs = await JobRun.find(filter).sort({ startedAt: -1 }).limit(limit).lean();
    res.json({
      runs: runs.map((run) => ({
        id: run._id,
        name: run.name,
        ok: run.ok,
        trigger: run.trigger,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        error: run.error || null,
        summary: run.summary || null,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// --- audit powers ---------------------------------------------------------------------------------

async function latestReviews(entryIds) {
  if (!entryIds.length) return new Map();
  const rows = await AuditReview.aggregate([
    { $match: { entry: { $in: entryIds } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$entry', status: { $first: '$status' }, note: { $first: '$note' }, at: { $first: '$createdAt' } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row]));
}

// GET /api/superadmin/audit/:id — one entry exactly as stored: the whole before and after, the
// chain hashes, the address. The ordinary audit screen deliberately never sends the snapshots
// (they hold whole member records); the super admin is the one who may read them.
async function auditEntry(req, res, next) {
  try {
    const entry = await AuditLog.findById(req.params.id).populate('performedBy', 'name email role').lean();
    if (!entry) return res.status(404).json({ message: 'No such audit entry' });

    const reviews = await AuditReview.find({ entry: entry._id })
      .sort({ createdAt: -1 })
      .populate('by', 'name')
      .lean();
    const read = readAuditEntry(entry);

    res.json({
      entry: {
        id: entry._id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        performedBy: entry.performedBy
          ? { id: entry.performedBy._id, name: entry.performedBy.name, email: entry.performedBy.email, role: entry.performedBy.role }
          : null,
        createdAt: entry.createdAt,
        ip: entry.ip || '',
        before: entry.before ?? null,
        after: entry.after ?? null,
        chain: {
          sequence: entry.chainSequence ?? null,
          hash: entry.hash || null,
          prevHash: entry.prevHash || null,
        },
        category: read.category,
        flags: read.flags,
        severity: read.severity,
        summary: read.summary,
      },
      reviews: reviews.map((review) => ({
        id: review._id,
        status: review.status,
        note: review.note,
        by: review.by?.name || 'Unknown',
        at: review.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/superadmin/audit/:id/review { status: 'flagged' | 'cleared', note }
async function reviewEntry(req, res, next) {
  try {
    const status = String(req.body?.status || '');
    if (!['flagged', 'cleared'].includes(status)) {
      return res.status(400).json({ message: 'status must be flagged or cleared' });
    }
    const entry = await AuditLog.findById(req.params.id).select('_id').lean();
    if (!entry) return res.status(404).json({ message: 'No such audit entry' });

    const review = await AuditReview.create({
      entry: entry._id,
      status,
      note: String(req.body?.note || '').trim().slice(0, 500),
      by: req.user._id,
    });
    // Not written to the audit trail: a review is the super admin's own working note about the
    // trail, kept in its own collection precisely so that making one never touches the chain.
    res.status(201).json({ review: { id: review._id, status: review.status, note: review.note, at: review.createdAt } });
  } catch (err) {
    next(err);
  }
}

// GET /api/superadmin/audit-reviews — entries currently flagged and not since cleared.
async function flaggedEntries(req, res, next) {
  try {
    const rows = await AuditReview.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$entry', status: { $first: '$status' }, note: { $first: '$note' }, at: { $first: '$createdAt' }, by: { $first: '$by' } } },
      { $match: { status: 'flagged' } },
      { $sort: { at: -1 } },
      { $limit: 100 },
    ]);
    const entries = await AuditLog.find({ _id: { $in: rows.map((row) => row._id) } })
      .populate('performedBy', 'name')
      .lean();
    const byId = new Map(entries.map((entry) => [String(entry._id), entry]));

    res.json({
      flagged: rows
        .map((row) => {
          const entry = byId.get(String(row._id));
          if (!entry) return null;
          const read = readAuditEntry(entry);
          return {
            id: entry._id,
            note: row.note,
            flaggedAt: row.at,
            action: entry.action,
            entityType: entry.entityType,
            performedBy: entry.performedBy?.name || 'Unknown',
            createdAt: entry.createdAt,
            summary: read.summary,
          };
        })
        .filter(Boolean),
    });
  } catch (err) {
    next(err);
  }
}

// The reviews for a page of entries, for the audit screen to badge them. Exported for it.
async function reviewStatusFor(entryIds) {
  const map = await latestReviews(entryIds);
  const out = {};
  for (const [id, row] of map) out[id] = { status: row.status, note: row.note };
  return out;
}

// GET /api/superadmin/export/audit — every entry, in full, as JSON.
//
// Streamed from a cursor so a trail of any length costs a document's worth of memory. This is the
// "everything" export that the Excel one is not: the snapshots, the hashes and the addresses are
// all in it, which is what a person checking the chain independently needs.
async function exportAuditFull(req, res, next) {
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-trail-full-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.setHeader('Cache-Control', 'no-store');

    let count = 0;
    res.write('{\n  "format": "chama-audit-export",\n  "version": 1,\n');
    res.write(`  "exportedAt": ${JSON.stringify(new Date().toISOString())},\n`);
    res.write('  "entries": [\n');
    const cursor = AuditLog.find().sort({ createdAt: 1, _id: 1 }).lean().cursor();
    for await (const entry of cursor) {
      // Honour the socket: a slow connection must slow the read, not fill the process's memory.
      if (!res.write(`${count ? ',\n' : ''}    ${JSON.stringify(entry)}`)) {
        await new Promise((resolve) => {
          const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
          };
          res.once('drain', done);
          res.once('close', done);
        });
        if (res.destroyed) return;
      }
      count += 1;
    }
    res.write(`\n  ],\n  "count": ${count}\n}\n`);
    res.end();

    await logAudit({
      action: 'create',
      entityType: 'System',
      entityId: req.user._id,
      performedBy: req.user._id,
      after: { action: 'audit-export-full', entries: count },
    });
  } catch (err) {
    if (res.headersSent) return res.destroy();
    next(err);
  }
}

// GET /api/superadmin/offsite — the copies kept off the server, newest first.
async function offsiteList(req, res, next) {
  try {
    const { offsiteEnabled, listOffsite, retention } = require('../utils/offsiteBackup');
    if (!offsiteEnabled()) return res.json({ enabled: false, files: [], retention: retention() });
    try {
      res.json({ enabled: true, files: await listOffsite(), retention: retention() });
    } catch (err) {
      res.json({ enabled: true, files: [], retention: retention(), error: `Could not read the list: ${err.message}` });
    }
  } catch (err) {
    next(err);
  }
}

// GET /api/superadmin/offsite/download?id= — one copy, handed over through the API.
//
// The file is private on the storage side, so there is no address to share or leak: the server
// fetches it with a signed request and passes it on to the super admin. Recorded in the audit trail
// like any other backup download.
async function offsiteDownload(req, res, next) {
  try {
    const { isOurs, signedUrlFor } = require('../utils/offsiteBackup');
    const id = String(req.query.id || '');
    if (!isOurs(id)) return res.status(400).json({ message: 'That is not one of the group\u2019s off-server backups.' });
    const upstream = await fetch(signedUrlFor(id));
    if (!upstream.ok) return res.status(404).json({ message: 'That copy could not be fetched. It may have been removed.' });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${id.split('/').pop().replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(bytes);
    await logAudit({
      action: 'create',
      entityType: 'System',
      entityId: req.user._id,
      performedBy: req.user._id,
      after: { action: 'backup-download', via: 'off-server copy', file: id.split('/').pop() },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  offsiteList,
  offsiteDownload,
  SWITCH_FIELDS,
  setMaintenance,
  setLock,
  setSwitches,
  setJobPaused,
  jobHistory,
  auditEntry,
  reviewEntry,
  flaggedEntries,
  reviewStatusFor,
  exportAuditFull,
};
