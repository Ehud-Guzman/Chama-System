const Minute = require('../models/Minute');
const { logAudit, snapshot } = require('../utils/auditLogger');

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
    const { title, date, content } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }

    const minute = await Minute.create({
      title: String(title).trim(),
      date: date ? new Date(date) : new Date(),
      content: String(content || ''),
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

    const { title, date, content } = req.body || {};
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

module.exports = { listMinutes, getMinute, createMinute, updateMinute, deleteMinute };
