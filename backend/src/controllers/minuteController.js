const Minute = require('../models/Minute');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { findActiveMemberByNationalId } = require('../utils/publicAccess');
const { sanitizeMinuteHtml } = require('../utils/sanitizeHtml');
const {
  MAX_SEARCH_RESULTS,
  plainTextOf,
  minuteSearchConditions,
  explainMatch,
} = require('../utils/minuteSearch');

// A minute's body is only sent when someone actually opens it — the list
// carries a stripped preview instead. Minutes run to pages of rich text, and the
// members' page is read on a phone with a data bundle.
function previewOf(content) {
  return plainTextOf(content).slice(0, 160);
}

// `match` is present only on a search result: it carries the words around the hit
// (see utils/minuteSearch), which is a better thing to open a result with than the
// minute's first line.
function publicShape(minute, match) {
  const snippet = match?.field === 'content' ? match.snippet : '';
  return {
    id: minute._id,
    title: minute.title,
    date: minute.date,
    preview: snippet || previewOf(minute.content),
    updatedAt: minute.updatedAt,
  };
}

// One search, shared by the office's list and the members' one so the two can never
// disagree about what counts as a match.
//
// It is deliberately not paged: a word found on page three would be a word the
// reader never saw, and the answer a person wants is "which meetings mentioned
// this", not the third screen of them. So the newest candidates are scanned up to
// the ceiling, the ones that genuinely contain the term are explained, and the
// response says whether the scan ran out of room.
async function searchMinutes(term, baseFilter, shape) {
  const candidates = await Minute.find({ ...baseFilter, $or: minuteSearchConditions(term) })
    .sort({ date: -1, createdAt: -1 })
    .limit(MAX_SEARCH_RESULTS)
    .lean();

  const minutes = [];
  for (const candidate of candidates) {
    const match = explainMatch(candidate, term);
    if (match) minutes.push(shape(candidate, match));
  }

  return {
    minutes,
    total: minutes.length,
    page: 1,
    pages: 1,
    query: term,
    // True when there were more candidates than were looked at, so the oldest
    // matches may not be here. The screen says so rather than letting a truncated
    // list read as the whole answer.
    truncated: candidates.length === MAX_SEARCH_RESULTS,
  };
}

// GET /api/minutes?page=&limit=&q= — admin-only, newest first. `q` searches the
// minutes themselves: any word from any meeting, in the titles and in the bodies,
// rather than only the ones already loaded on the screen.
async function listMinutes(req, res, next) {
  try {
    const term = String(req.query.q || '').trim();
    if (term) {
      // The whole minute comes back, not a preview: this is the screen the minute is
      // written on, and a result has to be openable for editing straight from the
      // list it was found in.
      const found = await searchMinutes(term, { deleted: false }, (minute, match) => ({
        ...minute,
        match,
      }));
      return res.json(found);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const [minutes, total] = await Promise.all([
      Minute.find({ deleted: false })
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('createdBy', 'name')
        .lean(),
      Minute.countDocuments({ deleted: false }),
    ]);

    res.json({ minutes, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
}

// GET /api/minutes/:id
async function getMinute(req, res, next) {
  try {
    const minute = await Minute.findOne({ _id: req.params.id, deleted: false })
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .lean();
    if (!minute) return res.status(404).json({ message: 'Minute not found' });
    res.json({ minute });
  } catch (err) {
    next(err);
  }
}

// POST /api/minutes
async function createMinute(req, res, next) {
  try {
    const { title, date, content, visibleToMembers } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }

    const minute = await Minute.create({
      title: String(title).trim(),
      date: date ? new Date(date) : new Date(),
      // Cleaned against the editor's own schema before storage: the API is what
      // every client talks to, so it cannot rely on the one editor that happens to
      // be in the admin app to keep scripts out of a member-visible page.
      content: sanitizeMinuteHtml(content),
      visibleToMembers: visibleToMembers === undefined ? true : Boolean(visibleToMembers),
      createdBy: req.user._id,
    });

    await logAudit({
      action: 'create',
      entityType: 'Minute',
      entityId: minute._id,
      performedBy: req.user._id,
      after: snapshot(minute),
    });
    res.status(201).json({ minute });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/minutes/:id
async function updateMinute(req, res, next) {
  try {
    const minute = await Minute.findOne({ _id: req.params.id, deleted: false });
    if (!minute) return res.status(404).json({ message: 'Minute not found' });
    const before = snapshot(minute);

    const { title, date, content, visibleToMembers } = req.body || {};
    if (title !== undefined) {
      if (!String(title).trim()) return res.status(400).json({ message: 'Title cannot be empty' });
      minute.title = String(title).trim();
    }
    if (date !== undefined && date !== null && date !== '') {
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid date' });
      minute.date = d;
    }
    if (content !== undefined) minute.content = sanitizeMinuteHtml(content);
    if (visibleToMembers !== undefined) minute.visibleToMembers = Boolean(visibleToMembers);
    minute.updatedBy = req.user._id;

    await minute.save();
    await logAudit({
      action: 'update',
      entityType: 'Minute',
      entityId: minute._id,
      performedBy: req.user._id,
      before,
      after: snapshot(minute),
    });
    res.json({ minute });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/minutes/:id — soft delete
async function deleteMinute(req, res, next) {
  try {
    const minute = await Minute.findOne({ _id: req.params.id, deleted: false });
    if (!minute) return res.status(404).json({ message: 'Minute not found' });
    const before = snapshot(minute);

    minute.deleted = true;
    await minute.save();
    await logAudit({
      action: 'delete',
      entityType: 'Minute',
      entityId: minute._id,
      performedBy: req.user._id,
      before,
      after: snapshot(minute),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// GET /api/public/minutes?nationalId=&page=&limit=&q= — PUBLIC, ID-gated. Members
// read the minutes; a minute an admin marked as not-for-members never appears
// here, and the body itself is held back until one is opened. `q` searches the
// minutes for a word from a meeting and answers with the sentence it was found in.
async function publicListMinutes(req, res, next) {
  try {
    const gate = await findActiveMemberByNationalId(req.query.nationalId);
    if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });

    const visible = { deleted: false, visibleToMembers: { $ne: false } };

    const term = String(req.query.q || '').trim();
    if (term) {
      // publicShape is handed over as a function, so what crosses the wire is the
      // preview and never the minute's body.
      const found = await searchMinutes(term, visible, publicShape);
      return res.json(found);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const [minutes, total] = await Promise.all([
      Minute.find(visible)
        .select('title date content updatedAt')
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Minute.countDocuments(visible),
    ]);

    res.json({
      minutes: minutes.map((minute) => publicShape(minute)),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/public/minutes/:id?nationalId= — PUBLIC, ID-gated. The single minute's
// full body. Deliberately not part of the list response: a member reading on a
// phone shouldn't download every minute's full rich text to read one.
async function publicGetMinute(req, res, next) {
  try {
    const gate = await findActiveMemberByNationalId(req.query.nationalId);
    if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });

    const minute = await Minute.findOne({
      _id: req.params.id,
      deleted: false,
      visibleToMembers: { $ne: false },
    })
      .select('title date content updatedAt')
      .lean();

    if (!minute) return res.status(404).json({ message: 'not_found' });

    res.json({
      minute: {
        id: minute._id,
        title: minute.title,
        date: minute.date,
        content: minute.content || '',
        updatedAt: minute.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMinutes,
  getMinute,
  createMinute,
  updateMinute,
  deleteMinute,
  publicListMinutes,
  publicGetMinute,
};
