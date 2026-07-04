const ContributionType = require('../models/ContributionType');
const { logAudit, snapshot } = require('../utils/auditLogger');

// GET /api/types?all=true — active only by default, ?all=true includes inactive
async function listTypes(req, res, next) {
  try {
    const filter = req.query.all === 'true' ? {} : { active: true };
    const types = await ContributionType.find(filter).sort({ name: 1 });
    res.json({ types });
  } catch (err) {
    next(err);
  }
}

// POST /api/types
async function createType(req, res, next) {
  try {
    const { name, description, isWeekly, weeklyAmount, tracksExpenses } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }
    const type = await ContributionType.create({
      name: String(name).trim(),
      description: String(description || '').trim(),
      isWeekly: Boolean(isWeekly),
      weeklyAmount: Number(weeklyAmount) || 0,
      tracksExpenses: Boolean(tracksExpenses),
      createdBy: req.user._id,
    });
    await logAudit({
      action: 'create',
      entityType: 'ContributionType',
      entityId: type._id,
      performedBy: req.user._id,
      after: snapshot(type),
    });
    res.status(201).json({ type });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/types/:id — edit name/description or deactivate/reactivate
async function updateType(req, res, next) {
  try {
    const type = await ContributionType.findById(req.params.id);
    if (!type) return res.status(404).json({ message: 'Contribution type not found' });
    const before = snapshot(type);

    const { name, description, active, isWeekly, weeklyAmount, tracksExpenses } = req.body || {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ message: 'Name cannot be empty' });
      type.name = String(name).trim();
    }
    if (description !== undefined) type.description = String(description).trim();
    if (active !== undefined) type.active = Boolean(active);
    if (isWeekly !== undefined) type.isWeekly = Boolean(isWeekly);
    if (weeklyAmount !== undefined) type.weeklyAmount = Number(weeklyAmount) || 0;
    if (tracksExpenses !== undefined) type.tracksExpenses = Boolean(tracksExpenses);

    await type.save();
    await logAudit({
      action: 'update',
      entityType: 'ContributionType',
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

module.exports = { listTypes, createType, updateType };
