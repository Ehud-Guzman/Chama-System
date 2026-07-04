const Pledge = require('../models/Pledge');
const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const { logAudit, snapshot } = require('../utils/auditLogger');

// PUT /api/members/:memberId/pledges/:typeId — upsert (one pledge per member+type)
async function setPledge(req, res, next) {
  try {
    const { memberId, typeId } = req.params;
    const n = Number(req.body?.amount);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ message: 'Pledge amount must be a number of zero or more' });
    }

    const [member, type] = await Promise.all([
      Member.findById(memberId).select('_id'),
      ContributionType.findById(typeId).select('_id'),
    ]);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    if (!type) return res.status(404).json({ message: 'Contribution type not found' });

    const existing = await Pledge.findOne({ memberId, typeId });
    const before = snapshot(existing);

    const pledge = existing || new Pledge({ memberId, typeId });
    pledge.amount = n;
    pledge.setBy = req.user._id;
    await pledge.save();

    await logAudit({
      action: existing ? 'update' : 'create',
      entityType: 'Pledge',
      entityId: pledge._id,
      performedBy: req.user._id,
      before,
      after: snapshot(pledge),
    });
    res.json({ pledge });
  } catch (err) {
    next(err);
  }
}

module.exports = { setPledge };
