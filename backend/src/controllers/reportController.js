const Contribution = require('../models/Contribution');
const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const Fine = require('../models/Fine');
const AuditLog = require('../models/AuditLog');
const { nonPersonalTypeIds } = require('../utils/personalTypes');
const { buildWeeklySchedule } = require('../utils/weeklySchedule');

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Shared by /performance and /performance/export: per active member, personal
// total, weekly-schedule consistency (personal weekly types only — group
// funds like Chai don't reflect individual effort), and pending fines.
async function computePerformance() {
  const [members, personalWeeklyTypes, excludedTypeIds] = await Promise.all([
    Member.find({ active: true }).sort({ name: 1 }).lean(),
    ContributionType.find({ isWeekly: true, isGroupFund: false, active: true }).lean(),
    nonPersonalTypeIds(),
  ]);

  const memberIds = members.map((m) => m._id);
  const [contributions, pendingFines] = await Promise.all([
    Contribution.find({ memberId: { $in: memberIds }, deleted: false })
      .select('memberId typeId amount date')
      .lean(),
    Fine.aggregate([
      { $match: { memberId: { $in: memberIds }, deleted: false, remaining: { $gt: 0 } } },
      { $group: { _id: '$memberId', total: { $sum: '$remaining' } } },
    ]),
  ]);

  const excludedSet = new Set(excludedTypeIds.map(String));
  const finesMap = new Map(pendingFines.map((f) => [String(f._id), f.total]));
  const contribByMember = new Map();
  for (const c of contributions) {
    const key = String(c.memberId);
    if (!contribByMember.has(key)) contribByMember.set(key, []);
    contribByMember.get(key).push(c);
  }

  const rows = members.map((member) => {
    const own = contribByMember.get(String(member._id)) || [];
    const totalContributed = own
      .filter((c) => !excludedSet.has(String(c.typeId)))
      .reduce((sum, c) => sum + c.amount, 0);
    const lastContributionDate = own.reduce(
      (latest, c) => (!latest || c.date > latest ? c.date : latest),
      null
    );

    let weeksExpected = 0;
    let weeksPaid = 0;
    let weeksPartial = 0;
    let weeksUnpaid = 0;
    for (const type of personalWeeklyTypes) {
      const typeContributions = own.filter((c) => String(c.typeId) === String(type._id));
      const weeks = buildWeeklySchedule(member.joinDate, type.weeklyAmount, typeContributions);
      weeksExpected += weeks.length;
      weeksPaid += weeks.filter((w) => w.status === 'paid').length;
      weeksPartial += weeks.filter((w) => w.status === 'partial').length;
      weeksUnpaid += weeks.filter((w) => w.status === 'unpaid').length;
    }
    const consistency = weeksExpected > 0 ? Math.round((weeksPaid / weeksExpected) * 100) : null;

    return {
      memberId: member._id,
      name: member.name,
      regNumber: member.regNumber || null,
      phone: member.phone,
      totalContributed,
      weeksExpected,
      weeksPaid,
      weeksPartial,
      weeksUnpaid,
      consistency,
      pendingFines: finesMap.get(String(member._id)) || 0,
      lastContributionDate,
    };
  });

  // Best performers first; members with no weekly schedule yet (consistency
  // null) sort to the bottom rather than being treated as 0%.
  rows.sort((a, b) => (b.consistency ?? -1) - (a.consistency ?? -1));
  return rows;
}

// GET /api/reports/performance — ranked member consistency (personal weekly
// types only) and pending fines, for spotting who's keeping up and who isn't.
async function performance(req, res, next) {
  try {
    res.json({ members: await computePerformance() });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/performance/export — same data as CSV
async function exportPerformance(req, res, next) {
  try {
    const rows = await computePerformance();
    const lines = [
      [
        'name',
        'regNumber',
        'phone',
        'totalContributed',
        'weeksExpected',
        'weeksPaid',
        'weeksPartial',
        'weeksUnpaid',
        'consistencyPercent',
        'pendingFines',
        'lastContributionDate',
      ].join(','),
    ];
    for (const r of rows) {
      lines.push(
        [
          csvEscape(r.name),
          csvEscape(r.regNumber || ''),
          csvEscape(r.phone),
          r.totalContributed,
          r.weeksExpected,
          r.weeksPaid,
          r.weeksPartial,
          r.weeksUnpaid,
          r.consistency ?? '',
          r.pendingFines,
          r.lastContributionDate ? new Date(r.lastContributionDate).toISOString().slice(0, 10) : '',
        ].join(',')
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="member-performance.csv"');
    res.send('﻿' + lines.join('\r\n'));
  } catch (err) {
    next(err);
  }
}

// Shared by /monthly and /monthly/export: total contributed per calendar
// month, split into personal vs group-fund money.
async function computeMonthly() {
  const excludedTypeIds = await nonPersonalTypeIds();
  const excludedSet = new Set(excludedTypeIds.map(String));

  const rows = await Contribution.aggregate([
    { $match: { deleted: false } },
    {
      $group: {
        _id: { month: { $dateToString: { format: '%Y-%m', date: '$date' } }, typeId: '$typeId' },
        total: { $sum: '$amount' },
      },
    },
    {
      $lookup: {
        from: 'contributiontypes',
        localField: '_id.typeId',
        foreignField: '_id',
        as: 'type',
      },
    },
    { $unwind: '$type' },
    {
      $project: {
        _id: 0,
        month: '$_id.month',
        typeId: '$_id.typeId',
        typeName: '$type.name',
        total: 1,
      },
    },
  ]);

  const byMonth = new Map();
  for (const r of rows) {
    if (!byMonth.has(r.month)) {
      byMonth.set(r.month, { month: r.month, total: 0, personalTotal: 0, groupFundTotal: 0, byType: [] });
    }
    const entry = byMonth.get(r.month);
    entry.total += r.total;
    if (excludedSet.has(String(r.typeId))) entry.groupFundTotal += r.total;
    else entry.personalTotal += r.total;
    entry.byType.push({ name: r.typeName, total: r.total });
  }

  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

// GET /api/reports/monthly — total raised per calendar month
async function monthly(req, res, next) {
  try {
    res.json({ months: await computeMonthly() });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/monthly/export — same data as CSV, one row per month × type
async function exportMonthly(req, res, next) {
  try {
    const months = await computeMonthly();
    const lines = [['month', 'type', 'total'].join(',')];
    for (const m of months) {
      for (const t of m.byType) {
        lines.push([csvEscape(m.month), csvEscape(t.name), t.total].join(','));
      }
      lines.push([csvEscape(m.month), 'TOTAL (all types)', m.total].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="monthly-totals.csv"');
    res.send('﻿' + lines.join('\r\n'));
  } catch (err) {
    next(err);
  }
}

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

module.exports = {
  summary,
  exportContributions,
  auditLog,
  performance,
  exportPerformance,
  monthly,
  exportMonthly,
};
