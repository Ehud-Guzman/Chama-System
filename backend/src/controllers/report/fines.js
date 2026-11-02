// The reports controller, part: fines. controllers/reportController.js is the index the routes use.

const Fine = require('../../models/Fine');
const { sendWorkbook } = require('../../utils/xlsxExport');
const { aboutSheet } = require('../../utils/aboutSheet');
const { getOrCreateSettings } = require('../../utils/settings');

// How many members the "who owes what" list carries. A report payload should not be
// unbounded, but a silently truncated list is worse than a long one — the office would
// read the first hundred names as the whole answer. The count of members owing is sent
// separately and the screen says so when the two disagree.
const BY_MEMBER_LIST_LIMIT = 500;

// The group's fines, in the three cuts the office asks for by name: what has been
// issued and what is still owed in total, which fine types carry the debt, who owes
// it, and how it has moved month by month.
async function computeFinesReport() {
  const [totals, byType, byMemberRaw, byMonth, owing, unpaid] = await Promise.all([
    Fine.aggregate([
      { $match: { deleted: false } },
      {
        $group: {
          _id: null,
          issued: { $sum: '$amount' },
          outstanding: { $sum: '$remaining' },
          count: { $sum: 1 },
          pendingCount: { $sum: { $cond: [{ $gt: ['$remaining', 0] }, 1, 0] } },
        },
      },
    ]),
    Fine.aggregate([
      { $match: { deleted: false } },
      {
        $group: {
          _id: '$typeId',
          issued: { $sum: '$amount' },
          outstanding: { $sum: '$remaining' },
          count: { $sum: 1 },
        },
      },
      { $lookup: { from: 'finetypes', localField: '_id', foreignField: '_id', as: 'type' } },
      { $unwind: '$type' },
      {
        $project: {
          _id: 0,
          name: '$type.name',
          category: '$type.category',
          issued: 1,
          outstanding: 1,
          count: 1,
        },
      },
      { $sort: { outstanding: -1, issued: -1 } },
    ]),
    // Who owes it — and, because "who owes what" always leads to "what for", each
    // member's own debt split by fine type, with the date of his oldest unpaid fine.
    Fine.aggregate([
      { $match: { deleted: false, remaining: { $gt: 0 } } },
      {
        $group: {
          _id: { member: '$memberId', type: '$typeId' },
          issued: { $sum: '$amount' },
          outstanding: { $sum: '$remaining' },
          count: { $sum: 1 },
          oldest: { $min: '$date' },
        },
      },
      { $lookup: { from: 'finetypes', localField: '_id.type', foreignField: '_id', as: 'typeDoc' } },
      { $unwind: { path: '$typeDoc', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$_id.member',
          issued: { $sum: '$issued' },
          outstanding: { $sum: '$outstanding' },
          fines: { $sum: '$count' },
          oldestUnpaid: { $min: '$oldest' },
          newestUnpaid: { $max: '$oldest' },
          types: {
            $push: {
              name: { $ifNull: ['$typeDoc.name', 'Fine'] },
              category: { $ifNull: ['$typeDoc.category', ''] },
              outstanding: '$outstanding',
              count: '$count',
              oldest: '$oldest',
            },
          },
        },
      },
      { $lookup: { from: 'members', localField: '_id', foreignField: '_id', as: 'member' } },
      { $unwind: '$member' },
      {
        $project: {
          _id: 0,
          memberId: '$_id',
          name: '$member.name',
          regNumber: '$member.regNumber',
          phone: '$member.phone',
          active: '$member.active',
          issued: 1,
          outstanding: 1,
          fines: 1,
          oldestUnpaid: 1,
          newestUnpaid: 1,
          types: 1,
        },
      },
      { $sort: { outstanding: -1, fines: -1, name: 1 } },
      { $limit: BY_MEMBER_LIST_LIMIT },
    ]),
    Fine.aggregate([
      { $match: { deleted: false } },
      {
        $group: {
          // The group's own calendar month (Kenya, UTC+3), as every other report
          // groups it, so the same money lands in the same month on every screen.
          _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: 'Africa/Nairobi' } },
          issued: { $sum: '$amount' },
          outstanding: { $sum: '$remaining' },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, month: '$_id', issued: 1, outstanding: 1, count: 1 } },
      { $sort: { month: -1 } },
      { $limit: 24 },
    ]),
    // How many members owe something at all, counted rather than inferred from a list
    // that may have been cut off at BY_MEMBER_LIST_LIMIT.
    Fine.aggregate([
      { $match: { deleted: false, remaining: { $gt: 0 } } },
      { $group: { _id: '$memberId' } },
      { $count: 'membersOwing' },
    ]),
    // The oldest debt still standing — not the oldest fine ever issued, which is a
    // different date and a different sentence in a meeting.
    Fine.aggregate([
      { $match: { deleted: false, remaining: { $gt: 0 } } },
      { $group: { _id: null, oldestUnpaid: { $min: '$date' } } },
    ]),
  ]);

  // Biggest line first on every member's own breakdown, so a row reads top-down.
  const byMember = byMemberRaw.map((row) => ({
    ...row,
    types: [...(row.types || [])].sort((a, b) => b.outstanding - a.outstanding),
  }));

  const head = totals[0] || { issued: 0, outstanding: 0, count: 0, pendingCount: 0 };
  const membersOwing = owing[0]?.membersOwing || 0;

  return {
    totals: {
      issued: head.issued,
      outstanding: head.outstanding,
      cleared: head.issued - head.outstanding,
      count: head.count,
      pendingCount: head.pendingCount,
      clearedCount: head.count - head.pendingCount,
      membersOwing,
      oldestUnpaid: unpaid[0]?.oldestUnpaid || null,
    },
    byType,
    byMember,
    // Stated rather than hidden: the screen says "showing the largest N of M" when the
    // list had to be cut, instead of letting a truncated list read as the whole answer.
    byMemberLimit: BY_MEMBER_LIST_LIMIT,
    byMemberTruncated: membersOwing > byMember.length,
    byMonth,
  };
}

// GET /api/reports/fines
async function finesReport(req, res, next) {
  try {
    res.json(await computeFinesReport());
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/fines/export — the same cuts as a workbook.
async function exportFinesReport(req, res, next) {
  try {
    const report = await computeFinesReport();
    sendWorkbook(res, 'fines-report.xlsx', [
      aboutSheet({
        name: 'Fines',
        settings: await getOrCreateSettings(),
        req,
        counts: [['Fines on record', report.totals.count]],
        notes:
          'Every fine issued and not voided, with the totals, the fine types carrying the debt, ' +
          'who owes it and how it has moved month by month. Voided fines are excluded: they ' +
          'were issued and then cancelled, so nothing is owed on them.',
      }),
      {
        name: 'Totals',
        rows: [
          { Field: 'Fines on record', Value: report.totals.count },
          { Field: 'Amount issued', Value: report.totals.issued },
          { Field: 'Paid off', Value: report.totals.cleared },
          { Field: 'Still owed', Value: report.totals.outstanding },
          { Field: 'Not yet cleared', Value: report.totals.pendingCount },
        ],
      },
      { name: 'By fine type', rows: report.byType },
      {
        // Built field by field rather than by spreading the row: each member now carries
        // a nested breakdown of what he owes, and a nested object in a sheet is a cell
        // reading "[object Object]". "What for" flattens it into the words a person reads.
        name: 'By member',
        rows: report.byMember.map((m) => ({
          Member: m.name,
          'Reg number': m.regNumber || '',
          Phone: m.phone || '',
          'Fines owed': m.fines,
          'Amount issued': m.issued,
          'Still owed': m.outstanding,
          'Owing since': m.oldestUnpaid ? new Date(m.oldestUnpaid).toISOString().slice(0, 10) : '',
          'What for': (m.types || []).map((t) => `${t.name} (${t.count})`).join('; '),
          Status: m.active === false ? 'Resigned' : 'Active',
        })),
      },
      { name: 'By month', rows: report.byMonth },
    ]);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  computeFinesReport,
  exportFinesReport,
  finesReport,
};
