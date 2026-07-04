const Contribution = require('../models/Contribution');
const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const { logAudit, snapshot } = require('../utils/auditLogger');

const METHODS = ['cash', 'bank', 'mobile', 'other'];
const DUPLICATE_WINDOW_MS = 10 * 1000;

// Shared validation for create/update. Returns an error message or null.
function validateFields({ amount, date, method }, { partial = false } = {}) {
  if (!partial || amount !== undefined) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 'Amount must be a number greater than zero';
  }
  if (!partial || method !== undefined) {
    if (!METHODS.includes(method)) return 'Method must be one of: cash, bank, mobile, other';
  }
  if (date !== undefined && date !== null && date !== '') {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return 'Invalid date';
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (d > endOfToday) return 'Date cannot be in the future';
  }
  return null;
}

// GET /api/contributions?memberId=&method=&page=&limit=
async function listContributions(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = { deleted: false };
    if (req.query.memberId) filter.memberId = req.query.memberId;
    if (req.query.typeId) filter.typeId = req.query.typeId;
    if (req.query.method && METHODS.includes(req.query.method)) filter.method = req.query.method;

    const [contributions, total] = await Promise.all([
      Contribution.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('memberId', 'name phone regNumber')
        .populate('loggedBy', 'name')
        .populate('typeId', 'name')
        .lean(),
      Contribution.countDocuments(filter),
    ]);

    res.json({ contributions, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
}

// POST /api/contributions — loggedBy comes from the JWT, never the body
async function createContribution(req, res, next) {
  try {
    const { memberId, typeId, amount, date, method, note, clientRequestId } = req.body || {};

    // Idempotent replay: the same submit attempt (e.g. a retried request after
    // a dropped response) resolves to the original document, not a new one.
    if (clientRequestId) {
      const existing = await Contribution.findOne({ clientRequestId })
        .populate('memberId', 'name phone regNumber')
        .populate('typeId', 'name')
        .lean();
      if (existing) return res.status(200).json({ contribution: existing, replay: true });
    }

    const [member, type] = await Promise.all([
      Member.findById(memberId),
      ContributionType.findById(typeId),
    ]);
    if (!member || !member.active) {
      return res.status(400).json({ message: 'Member not found or inactive' });
    }
    if (!type || !type.active) {
      return res.status(400).json({ message: 'Contribution type not found or inactive' });
    }
    const invalid = validateFields({ amount, date, method });
    if (invalid) return res.status(400).json({ message: invalid });

    // Heuristic guard for duplicate submissions that don't carry a matching
    // clientRequestId (e.g. two browser tabs each generating their own key).
    const recentDuplicate = await Contribution.findOne({
      memberId: member._id,
      typeId: type._id,
      amount: Number(amount),
      method,
      deleted: false,
      createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
    }).lean();
    if (recentDuplicate) {
      return res.status(409).json({
        message: 'This looks like a duplicate of a contribution just logged for this member. Refresh and check before retrying.',
      });
    }

    let contribution;
    try {
      contribution = await Contribution.create({
        memberId: member._id,
        typeId: type._id,
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        method,
        note: String(note || '').trim(),
        loggedBy: req.user._id,
        clientRequestId: clientRequestId || undefined,
      });
    } catch (err) {
      // Two near-simultaneous requests with the same key both passed the
      // replay check above; the unique index is what actually decides the
      // race. The loser fetches and returns the winner's document.
      if (err.code === 11000 && clientRequestId) {
        const winner = await Contribution.findOne({ clientRequestId })
          .populate('memberId', 'name phone regNumber')
          .populate('typeId', 'name')
          .lean();
        if (winner) return res.status(200).json({ contribution: winner, replay: true });
      }
      throw err;
    }

    await logAudit({
      action: 'create',
      entityType: 'Contribution',
      entityId: contribution._id,
      performedBy: req.user._id,
      after: snapshot(contribution),
    });

    const populated = await Contribution.findById(contribution._id)
      .populate('memberId', 'name phone regNumber')
      .populate('typeId', 'name')
      .lean();
    res.status(201).json({ contribution: populated });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/contributions/:id
async function updateContribution(req, res, next) {
  try {
    const contribution = await Contribution.findById(req.params.id);
    if (!contribution || contribution.deleted) {
      return res.status(404).json({ message: 'Contribution not found' });
    }

    const { typeId, amount, date, method, note, expectedUpdatedAt } = req.body || {};
    // Optimistic concurrency: if the editor tells us what version it loaded
    // and someone else has since changed the record, refuse to overwrite it.
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== contribution.updatedAt.getTime()) {
      return res.status(409).json({
        message: 'This contribution was changed by someone else since you opened it. Refresh and try again.',
      });
    }
    const before = snapshot(contribution);
    const invalid = validateFields({ amount, date, method }, { partial: true });
    if (invalid) return res.status(400).json({ message: invalid });

    if (typeId !== undefined) {
      const type = await ContributionType.findById(typeId);
      if (!type) return res.status(400).json({ message: 'Contribution type not found' });
      contribution.typeId = type._id;
    }
    if (amount !== undefined) contribution.amount = Number(amount);
    if (date !== undefined && date !== null && date !== '') contribution.date = new Date(date);
    if (method !== undefined) contribution.method = method;
    if (note !== undefined) contribution.note = String(note).trim();

    await contribution.save();
    await logAudit({
      action: 'update',
      entityType: 'Contribution',
      entityId: contribution._id,
      performedBy: req.user._id,
      before,
      after: snapshot(contribution),
    });
    const populated = await Contribution.findById(contribution._id)
      .populate('memberId', 'name phone regNumber')
      .populate('typeId', 'name')
      .lean();
    res.json({ contribution: populated });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/contributions/:id — soft delete
async function deleteContribution(req, res, next) {
  try {
    const contribution = await Contribution.findById(req.params.id);
    if (!contribution || contribution.deleted) {
      return res.status(404).json({ message: 'Contribution not found' });
    }
    const before = snapshot(contribution);

    contribution.deleted = true;
    await contribution.save();
    await logAudit({
      action: 'delete',
      entityType: 'Contribution',
      entityId: contribution._id,
      performedBy: req.user._id,
      before,
      after: snapshot(contribution),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listContributions, createContribution, updateContribution, deleteContribution };
