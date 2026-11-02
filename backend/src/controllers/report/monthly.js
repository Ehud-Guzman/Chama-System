// The reports controller, part: monthly. controllers/reportController.js is the index the routes use.

const Contribution = require('../../models/Contribution');
const { nonPersonalTypeIds } = require('../../utils/personalTypes');
const { sendWorkbook } = require('../../utils/xlsxExport');
const { aboutSheet } = require('../../utils/aboutSheet');
const { getOrCreateSettings } = require('../../utils/settings');

// Shared by /monthly and /monthly/export: total contributed per calendar
// month, split into personal vs group-fund money, plus how many members actually
// put money in. The member figures are the ones the office reads — a month total
// on its own says nothing about whether the members paid it or a fund did.
async function computeMonthly() {
  const excludedTypeIds = await nonPersonalTypeIds();
  const excludedSet = new Set(excludedTypeIds.map(String));

  const rows = await Contribution.aggregate([
    { $match: { deleted: false } },
    {
      $group: {
        _id: {
          // Group by the group's own local calendar month (Kenya, UTC+3) —
          // a bare UTC grouping would misfile anything logged between
          // midnight and 3am into the previous month.
          month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: 'Africa/Nairobi' } },
          typeId: '$typeId',
          // Kept in the key so a month can also report how many members it took
          // to raise its total.
          memberId: '$memberId',
        },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
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
        memberId: '$_id.memberId',
        typeName: '$type.name',
        typeIsGroupFund: { $ifNull: ['$type.isGroupFund', false] },
        total: 1,
        count: 1,
      },
    },
  ]);

  const byMonth = new Map();
  const contributingMembers = new Set();

  for (const r of rows) {
    if (!byMonth.has(r.month)) {
      byMonth.set(r.month, {
        month: r.month,
        total: 0,
        personalTotal: 0,
        groupFundTotal: 0,
        count: 0,
        memberCount: 0,
        members: new Set(),
        byType: [],
      });
    }
    const entry = byMonth.get(r.month);
    entry.total += r.total;
    entry.count += r.count;

    const isGroupFund = Boolean(r.typeIsGroupFund) || excludedSet.has(String(r.typeId));
    if (isGroupFund) {
      entry.groupFundTotal += r.total;
    } else {
      entry.personalTotal += r.total;
      // Only members who put in their own money count as contributing for the
      // month; a Tea Fund row is collected from everyone automatically.
      entry.members.add(String(r.memberId));
      contributingMembers.add(String(r.memberId));
    }

    // One line per contribution type however many members paid into it.
    const typeEntry = entry.byType.find((t) => t.name === r.typeName);
    if (typeEntry) {
      typeEntry.total += r.total;
    } else {
      entry.byType.push({ name: r.typeName, total: r.total, isGroupFund });
    }
  }

  const months = [...byMonth.values()]
    .map((entry) => ({ ...entry, memberCount: entry.members.size, members: undefined }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  for (const month of months) month.byType.sort((a, b) => b.total - a.total);

  // The same figures across every month, for the headline the screen shows above
  // the list: "member contributions, all months" is the number that answers
  // "how much have the members actually put in?".
  const totals = {
    all: months.reduce((sum, m) => sum + m.total, 0),
    personal: months.reduce((sum, m) => sum + m.personalTotal, 0),
    groupFund: months.reduce((sum, m) => sum + m.groupFundTotal, 0),
    count: months.reduce((sum, m) => sum + m.count, 0),
    contributingMembers: contributingMembers.size,
  };

  return { months, totals };
}

// GET /api/reports/monthly — total raised per calendar month
async function monthly(req, res, next) {
  try {
    const { months, totals } = await computeMonthly();
    res.json({ months, totals });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/monthly/export — same data as an .xlsx workbook, one row per month × type
async function exportMonthly(req, res, next) {
  try {
    const { months, totals } = await computeMonthly();
    const sheetRows = [];
    for (const m of months) {
      for (const t of m.byType) {
        sheetRows.push({
          Month: m.month,
          Type: t.name,
          'Member contributions': t.isGroupFund ? 0 : t.total,
          'Group funds': t.isGroupFund ? t.total : 0,
          Total: t.total,
        });
      }
      // The month's member figure is the point of the sheet, so it gets its own
      // line rather than being left to be summed up by hand.
      sheetRows.push({
        Month: m.month,
        Type: 'MEMBERS THIS MONTH',
        'Member contributions': m.personalTotal,
        'Group funds': m.groupFundTotal,
        Total: m.total,
        Members: m.memberCount,
      });
    }
    sheetRows.push({
      Month: 'ALL MONTHS',
      Type: 'TOTAL',
      'Member contributions': totals.personal,
      'Group funds': totals.groupFund,
      Total: totals.all,
      Members: totals.contributingMembers,
    });
    sendWorkbook(res, 'monthly-totals.xlsx', [
      aboutSheet({
        name: 'Monthly totals',
        settings: await getOrCreateSettings(),
        req,
        counts: [['Months covered', months.length]],
        notes:
          'One line per calendar month (the group\u2019s own month, UTC+3), split by contribution ' +
          'type, with the members\u2019 own contributions kept apart from the group funds.',
      }),
      { name: 'Monthly totals', rows: sheetRows },
    ]);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  exportMonthly,
  monthly,
};
