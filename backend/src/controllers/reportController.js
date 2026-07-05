const Contribution = require('../models/Contribution');
const Member = require('../models/Member');
const AuditLog = require('../models/AuditLog');

// GET /api/reports/summary — total, per-method breakdown, zero-contribution member count
async function summary(req, res, next) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [byMethod, byTypeRaw, activeMembers, contributingIds, thisWeekAgg] = await Promise.all([
      Contribution.aggregate([
        { $match: { deleted: false } },
        { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Contribution.aggregate([
        { $match: { deleted: false } },
        { $group: { _id: '$typeId', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        {
          $lookup: {
            from: 'contributiontypes',
            localField: '_id',
            foreignField: '_id',
            as: 'type',
          },
        },
        { $unwind: '$type' },
        { $project: { _id: 0, typeId: '$_id', name: '$type.name', total: 1, count: 1 } },
        { $sort: { total: -1 } },
      ]),
      Member.countDocuments({ active: true }),
      Contribution.distinct('memberId', { deleted: false }),
      Contribution.aggregate([
        { $match: { deleted: false, date: { $gte: sevenDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const totalContributed = byMethod.reduce((sum, m) => sum + m.total, 0);
    const totalCount = byMethod.reduce((sum, m) => sum + m.count, 0);

    const contributingActive = await Member.countDocuments({
      _id: { $in: contributingIds },
      active: true,
    });

    res.json({
      totalContributed,
      thisWeekTotal: thisWeekAgg[0]?.total || 0,
      contributionCount: totalCount,
      activeMembers,
      membersWithZeroContributions: activeMembers - contributingActive,
      byMethod: byMethod
        .map((m) => ({ method: m._id, total: m.total, count: m.count }))
        .sort((a, b) => b.total - a.total),
      byType: byTypeRaw,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/export — all contributions with member names, CSV
async function exportContributions(req, res, next) {
  try {
    const contributions = await Contribution.find({ deleted: false })
      .sort({ date: 1, createdAt: 1 })
      .populate('memberId', 'name phone regNumber')
      .populate('loggedBy', 'name')
      .populate('typeId', 'name')
      .lean();

    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ['date', 'member', 'regNumber', 'phone', 'type', 'amount', 'method', 'note', 'loggedBy'].join(','),
    ];
    for (const c of contributions) {
      lines.push(
        [
          new Date(c.date).toISOString().slice(0, 10),
          esc(c.memberId?.name || 'Unknown'),
          esc(c.memberId?.regNumber || ''),
          esc(c.memberId?.phone || ''),
          esc(c.typeId?.name || ''),
          c.amount,
          c.method,
          esc(c.note || ''),
          esc(c.loggedBy?.name || ''),
        ].join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contributions.csv"');
    res.send('﻿' + lines.join('\r\n'));
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/audit-log?page=&limit=
async function auditLog(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const [entries, total] = await Promise.all([
      AuditLog.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('performedBy', 'name email')
        .lean(),
      AuditLog.countDocuments(),
    ]);

    res.json({ entries, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
}

module.exports = { summary, exportContributions, auditLog };
