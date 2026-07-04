const Fine = require('../models/Fine');
const Member = require('../models/Member');
const FineType = require('../models/FineType');
const { logAudit, snapshot } = require('../utils/auditLogger');

// GET /api/fines?memberId=&status=pending|settled&page=&limit=
async function listFines(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = { deleted: false };
    if (req.query.memberId) filter.memberId = req.query.memberId;
    if (req.query.status === 'pending') filter.remaining = { $gt: 0 };
    if (req.query.status === 'settled') filter.remaining = { $lte: 0 };

    const [fines, total] = await Promise.all([
      Fine.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('memberId', 'name phone regNumber')
        .populate('typeId', 'name')
        .populate('issuedBy', 'name')
        .lean(),
      Fine.countDocuments(filter),
    ]);

    res.json({ fines, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
}

// POST /api/fines
async function createFine(req, res, next) {
  try {
    const { memberId, typeId, amount, reason, date } = req.body || {};

    const [member, type] = await Promise.all([
      Member.findById(memberId),
      FineType.findById(typeId),
    ]);
    if (!member || !member.active) {
      return res.status(400).json({ message: 'Member not found or inactive' });
    }
    if (!type || !type.active) {
      return res.status(400).json({ message: 'Fine type not found or inactive' });
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ message: 'Amount must be a number greater than zero' });
    }

    const fine = await Fine.create({
      memberId: member._id,
      typeId: type._id,
      amount: n,
      remaining: n,
      reason: String(reason || '').trim(),
      date: date ? new Date(date) : new Date(),
      issuedBy: req.user._id,
    });

    await logAudit({
      action: 'create',
      entityType: 'Fine',
      entityId: fine._id,
      performedBy: req.user._id,
      after: snapshot(fine),
    });

    const populated = await Fine.findById(fine._id)
      .populate('memberId', 'name phone regNumber')
      .populate('typeId', 'name')
      .lean();
    res.status(201).json({ fine: populated });
  } catch (err) {
    next(err);
  }
}

// POST /api/fines/:id/settle — manual settlement (e.g. member paid cash directly,
// not through a logged contribution).
async function settleFine(req, res, next) {
  try {
    const fine = await Fine.findById(req.params.id);
    if (!fine || fine.deleted) return res.status(404).json({ message: 'Fine not found' });
    if (fine.remaining <= 0) return res.status(400).json({ message: 'Fine is already settled' });

    const n = Number(req.body?.amount);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ message: 'Amount must be a number greater than zero' });
    }
    const before = snapshot(fine);
    const applied = Math.min(n, fine.remaining);
    fine.remaining -= applied;
    fine.settlements.push({ contributionId: null, amount: applied, date: new Date() });

    await fine.save();
    await logAudit({
      action: 'update',
      entityType: 'Fine',
      entityId: fine._id,
      performedBy: req.user._id,
      before,
      after: snapshot(fine),
    });
    res.json({ fine });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/fines/:id — void a wrongly-issued fine (soft delete)
async function voidFine(req, res, next) {
  try {
    const fine = await Fine.findById(req.params.id);
    if (!fine || fine.deleted) return res.status(404).json({ message: 'Fine not found' });
    const before = snapshot(fine);

    fine.deleted = true;
    await fine.save();
    await logAudit({
      action: 'delete',
      entityType: 'Fine',
      entityId: fine._id,
      performedBy: req.user._id,
      before,
      after: snapshot(fine),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listFines, createFine, settleFine, voidFine };
