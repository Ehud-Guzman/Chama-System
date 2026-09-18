const Minute = require('../models/Minute');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { findActiveMemberByNationalId } = require('../utils/publicAccess');

// A minute's body is only sent when someone actually opens it — the list
// carries a stripped preview instead. Minutes run to pages of rich text, and the
// members' page is read on a phone with a data bundle.
function previewOf(content) {
  return String(content || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function publicShape(minute) {
  return {
    id: minute._id,
    title: minute.title,
    date: minute.date,
    preview: previewOf(minute.content),
    updatedAt: minute.updatedAt,
  };
}

// GET /api/minutes?page=&limit= — admin-only, newest first
async function listMinutes(req, res, next) {
  try {
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
      content: String(content || ''),
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
    if (content !== undefined) minute.content = String(content);
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

// GET /api/public/minutes?nationalId=&page=&limit= — PUBLIC, ID-gated. Members
// read the minutes; a minute an admin marked as not-for-members never appears
// here, and the body itself is held back until one is opened.
async function publicListMinutes(req, res, next) {
  try {
    const gate = await findActiveMemberByNationalId(req.query.nationalId);
    if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = { deleted: false, visibleToMembers: { $ne: false } };
    const [minutes, total] = await Promise.all([
      Minute.find(filter)
        .select('title date content updatedAt')
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Minute.countDocuments(filter),
    ]);

    res.json({
      minutes: minutes.map(publicShape),
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
