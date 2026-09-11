const FineType = require('../models/FineType');
const { logAudit, snapshot } = require('../utils/auditLogger');

// GET /api/fine-types?all=true&category= — active only by default, ?all=true
// includes inactive, ?category=financial|disciplinary filters by category
async function listFineTypes(req, res, next) {
  try {
    const filter = req.query.all === 'true' ? {} : { active: true };
    if (req.query.category) filter.category = req.query.category;
    const types = await FineType.find(filter).sort({ name: 1 });
    res.json({ types });
  } catch (err) {
    next(err);
  }
}

// POST /api/fine-types
async function createFineType(req, res, next) {
  try {
    const { name, description, category, defaultAmount } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }
    const type = await FineType.create({
      name: String(name).trim(),
      description: String(description || '').trim(),
      category: category === 'disciplinary' ? 'disciplinary' : 'financial',
      defaultAmount: Number(defaultAmount) > 0 ? Number(defaultAmount) : 0,
      createdBy: req.user._id,
    });
    await logAudit({
      action: 'create',
      entityType: 'FineType',
      entityId: type._id,
      performedBy: req.user._id,
      after: snapshot(type),
    });
    res.status(201).json({ type });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/fine-types/:id — edit name/description or deactivate/reactivate
async function updateFineType(req, res, next) {
  try {
    const type = await FineType.findById(req.params.id);
    if (!type) return res.status(404).json({ message: 'Fine type not found' });
    const before = snapshot(type);

    const { name, description, active, defaultAmount } = req.body || {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ message: 'Name cannot be empty' });
      type.name = String(name).trim();
    }
    if (description !== undefined) type.description = String(description).trim();
    if (active !== undefined) type.active = Boolean(active);
    if (defaultAmount !== undefined) {
      const n = Number(defaultAmount);
      type.defaultAmount = Number.isFinite(n) && n > 0 ? n : 0;
    }

    await type.save();
    await logAudit({
      action: 'update',
      entityType: 'FineType',
      entityId: type._id,
      performedBy: req.user._id,
      before,
      after: snapshot(type),
    });
    res.json({ type });
  } catch (err) {
    next(err);
  }
}

module.exports = { listFineTypes, createFineType, updateFineType };
