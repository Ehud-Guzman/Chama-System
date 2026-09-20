const Contribution = require('../models/Contribution');
const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');
const Fine = require('../models/Fine');
const AuditLog = require('../models/AuditLog');
const { carriedInTotals } = require('../utils/carriedIn');
const { nonPersonalTypeIds } = require('../utils/personalTypes');
const { buildWeeklySchedule } = require('../utils/weeklySchedule');
const { resolveConfig, scoredWeeks } = require('../utils/weekCycle');
const { bucketForType } = require('../utils/ledgerTypes');
const { fundBalance } = require('../utils/fundBalance');
const { getOrCreateSettings } = require('../utils/settings');
const { sendWorkbook } = require('../utils/xlsxExport');
const { totalFinesCollected } = require('../utils/finesCollected');
const { computeWeeklyReconciliation } = require('../utils/weeklyReconciliation');
const Expense = require('../models/Expense');

// Shared by /performance and /performance/export: per active member, personal
// total, weekly-schedule consistency (personal weekly types only — group
// funds like Chai don't reflect individual effort), and pending fines.
async function computePerformance() {
  const [members, personalWeeklyTypes, excludedTypeIds, settings] = await Promise.all([
    Member.find({ active: true }).sort({ name: 1 }).lean(),
    ContributionType.find({ isWeekly: true, isGroupFund: false, active: true }).lean(),
    nonPersonalTypeIds(),
    getOrCreateSettings(),
  ]);
  const config = resolveConfig(settings);

  const memberIds = members.map((m) => m._id);
  const [contributions, pendingFines] = await Promise.all([
    Contribution.find({ memberId: { $in: memberIds }, deleted: false })
      .select('memberId typeId amount grossAmount date')
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
    // All time means all time: what he brought in when the books opened (his
    // verified paper-ledger balance) plus everything logged against him since.
    // Without the carried-forward figure every member reads Ksh 1,400 on the day
    // the cycle starts, while holding a hundred thousand.
    const collected = own
      .filter((c) => !excludedSet.has(String(c.typeId)))
      .reduce((sum, c) => sum + c.amount, 0);
    const carriedIn = Number(member.openingBalance) || 0;
    const totalContributed = carriedIn + collected;
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
      const weeks = buildWeeklySchedule(config, config.weeklyAmount, typeContributions);
      // The opening week is the baseline: it carried no expectation and no
      // payment, so counting it would drag every member's consistency down and
      // report a week nobody could have paid. The week still running is not
      // expected of anybody yet either — its Thursday is to come — which is the
      // same rule the 1,400 and the tea follow.
      const scored = weeks.filter((w) => !w.isBaseline && !w.isCurrent);
      weeksExpected += scored.length;
      weeksPaid += scored.filter((w) => w.status === 'paid').length;
      weeksPartial += scored.filter((w) => w.status === 'partial').length;
      weeksUnpaid += scored.filter((w) => w.status === 'unpaid').length;
    }
    const consistency = weeksExpected > 0 ? Math.round((weeksPaid / weeksExpected) * 100) : null;

    return {
      memberId: member._id,
      name: member.name,
      regNumber: member.regNumber || null,
      phone: member.phone,
      totalContributed,
      // The two halves of that figure, so the screen can say which is which.
      carriedIn,
      collected,
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
    const members = await computePerformance();
    res.json({ members, totals: performanceTotals(members) });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/summary — total, per-method breakdown, zero-contribution
// member count, and net cash balance after tracked fund expenses.
async function summary(req, res, next) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [byMethod, byTypeRaw, activeMembers, contributingIds, thisWeekAgg, finesCollected, expensesAgg, settings] =
      await Promise.all([
        Contribution.aggregate([
          { $match: { deleted: false } },
          { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        Contribution.aggregate([
          { $match: { deleted: false } },
          { $group: { _id: '$typeId', total: { $sum: '$amount' }, count: { $sum: 1 } } },
          { $lookup: { from: 'contributiontypes', localField: '_id', foreignField: '_id', as: 'type' } },
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
        totalFinesCollected(),
        Expense.aggregate([
          { $match: { deleted: false } },
          { $group: { _id: '$typeId', total: { $sum: '$amount' } } },
          { $lookup: { from: 'contributiontypes', localField: '_id', foreignField: '_id', as: 'type' } },
          { $unwind: '$type' },
          { $match: { 'type.isRecoverable': { $ne: true } } },
          { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
        // The cycle's own figures, for the Tea Fund's derived income below.
        getOrCreateSettings(),
      ]);

    const totalContributed = byMethod.reduce((sum, m) => sum + m.total, 0);
    const totalCount = byMethod.reduce((sum, m) => sum + m.count, 0);
    const totalExpenses = expensesAgg[0]?.total || 0;

    // What the members put in before this ledger existed. It is real money —
    // the paper ledger's own totals, verified member by member at go-live — so
    // the all-time figure has to carry it; the rows only know what has been
    // logged since. `collected` is the row total kept apart, because the
    // per-method and per-type breakdowns below it are rows and nothing else.
    const carriedIn = await carriedInTotals();
    const collected = totalContributed;
    const allTime = collected + carriedIn.total;

    const contributingActive = await Member.countDocuments({
      _id: { $in: contributingIds },
      active: true,
    });

    // The office's fines position, all time. Kept beside the contribution figures
    // because a committee asks the three questions together: what came in, what is
    // in the funds, and what is still owed in fines.
    const [fineAgg, fineByType, fundTypes] = await Promise.all([
      Fine.aggregate([
        { $match: { deleted: false } },
        {
          $group: {
            _id: null,
            issued: { $sum: '$amount' },
            remaining: { $sum: '$remaining' },
            count: { $sum: 1 },
            pendingCount: { $sum: { $cond: [{ $gt: ['$remaining', 0] }, 1, 0] } },
          },
        },
      ]),
      Fine.aggregate([
        { $match: { deleted: false } },
        { $group: { _id: '$typeId', issued: { $sum: '$amount' }, remaining: { $sum: '$remaining' }, count: { $sum: 1 } } },
        { $lookup: { from: 'finetypes', localField: '_id', foreignField: '_id', as: 'type' } },
        { $unwind: '$type' },
        {
          $project: {
            _id: 0,
            name: '$type.name',
            category: '$type.category',
            issued: 1,
            remaining: 1,
            count: 1,
          },
        },
        { $sort: { remaining: -1 } },
      ]),
      ContributionType.find().select('name isGroupFund tracksExpenses openingBalance active').lean(),
    ]);

    const finesSummary = {
      issued: fineAgg[0]?.issued || 0,
      outstanding: fineAgg[0]?.remaining || 0,
      cleared: (fineAgg[0]?.issued || 0) - (fineAgg[0]?.remaining || 0),
      count: fineAgg[0]?.count || 0,
      pendingCount: fineAgg[0]?.pendingCount || 0,
      clearedCount: (fineAgg[0]?.count || 0) - (fineAgg[0]?.pendingCount || 0),
      collected: finesCollected,
      byType: fineByType,
    };

    // What each fund holds, as the office's own setup screen works it out — with
    // the Tea Fund's automatic income included, because this is the office's copy
    // and a fund list that disagrees with the ledger is worse than none.
    const config = resolveConfig(settings);
    const chaiType = fundTypes.find((t) => bucketForType(t) === 'chai') || null;
    const teaBeforeCycle = chaiType
      ? await Contribution.aggregate([
          { $match: { deleted: false, typeId: chaiType._id, date: { $lt: config.anchorDate } } },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$grossAmount', '$amount'] } } } },
        ])
      : [];
    const teaIncome = config.chaiAmount * scoredWeeks(config) * activeMembers + (teaBeforeCycle[0]?.total || 0);

    const funds = await Promise.all(
      fundTypes
        .filter((t) => t.active !== false && (t.isGroupFund || t.tracksExpenses))
        .map(async (t) => {
          const derived = bucketForType(t) === 'chai' ? teaIncome : 0;
          const balance = await fundBalance(t._id, {
            carriedIn: t.openingBalance,
            extraIncome: derived,
          });
          return {
            name: t.name,
            tracksExpenses: Boolean(t.tracksExpenses),
            // The part of the balance the ledger derives rather than reads from a
            // row — today only the automatic tea — so a list can name it.
            derived,
            ...balance,
            // fundBalance() folds the carry-in and the derived income into
            // totalContributed, so what actually came in as logged rows has to be
            // named separately for a screen that shows its work.
            collected: balance.totalContributed - balance.carriedIn - derived,
            spent: balance.totalExpenses,
          };
        })
    );

    res.json({
      totalContributed: allTime,
      // Named parts, so a screen can show what the total is made of rather than
      // leaving the difference to be guessed at.
      carriedIn: carriedIn.total,
      carriedInMemberBalances: carriedIn.memberBalances,
      carriedInFundFloats: carriedIn.fundFloats,
      collected,
      totalExpenses,
      // Everything raised, all time, less what has been spent from
      // expense-tracking funds (e.g. Chai) — the group's money on hand. It is
      // the all-time total that answers that question, not the row total.
      netBalance: allTime - totalExpenses,
      thisWeekTotal: thisWeekAgg[0]?.total || 0,
      contributionCount: totalCount,
      activeMembers,
      membersWithZeroContributions: activeMembers - contributingActive,
      byMethod: byMethod
        .map((m) => ({ method: m._id, total: m.total, count: m.count }))
        .sort((a, b) => b.total - a.total),
      byType: byTypeRaw,
      // Cash collected against fines never shows up as a Contribution — kept
      // separate from totalContributed so it isn't mistaken for total cash held.
      finesCollected,
      // What is owed in fines, by type, beside what has been collected — the two
      // halves of the same story, and the figures a committee asks for by name.
      fines: finesSummary,
      // What each fund holds today, carry-in and automatic tea included.
      funds,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/performance/export — same data as an .xlsx workbook
async function exportPerformance(req, res, next) {
  try {
    const rows = await computePerformance();
    const totals = performanceTotals(rows);
    const sheetRows = rows.map((r) => ({
      Name: r.name,
      'Reg number': r.regNumber || '',
      Phone: r.phone,
      'Total contributed': r.totalContributed,
      'Weeks expected': r.weeksExpected,
      'Weeks paid': r.weeksPaid,
      'Weeks partial': r.weeksPartial,
      'Weeks unpaid': r.weeksUnpaid,
      'Consistency %': r.consistency ?? '',
      'Pending fines': r.pendingFines,
      'Last contribution': r.lastContributionDate
        ? new Date(r.lastContributionDate).toISOString().slice(0, 10)
        : '',
    }));
    sendWorkbook(res, 'member-performance.xlsx', [
      aboutSheet({
        name: 'Member performance',
        settings: await getOrCreateSettings(),
        req,
        counts: [['Members', rows.length]],
        notes:
          'One line per active member. "Total contributed" includes the balance he carried in ' +
          'when the books opened; consistency counts personal weekly weeks only, and the ' +
          'opening week and the week still running are not scored.',
      }),
      { name: 'Performance', rows: sheetRows },
      {
        name: 'Totals',
        rows: [
          { Field: 'Members', Value: totals.members },
          { Field: 'Total contributed (all-time)', Value: totals.totalContributed },
          { Field: 'Carried forward inside that', Value: totals.carriedIn },
          { Field: 'Average consistency (%)', Value: totals.averageConsistency ?? '' },
          { Field: 'Members fully paid', Value: totals.fullyPaidMembers },
          { Field: 'Members below 80%', Value: totals.membersBehind },
          { Field: 'Weeks paid / expected', Value: `${totals.weeksPaid} / ${totals.weeksExpected}` },
          { Field: 'Pending fines', Value: totals.pendingFines },
        ],
      },
    ]);
  } catch (err) {
    next(err);
  }
}

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

// Every export says what it is, who asked for it and when, as its first sheet. A
// workbook that turns up in a WhatsApp group a year later should be readable
// without anyone having to remember which screen it came from — and a figure with
// no stated scope is how two people end up arguing about the same report.
function aboutSheet({ name, settings, req, counts = [], notes = '' }) {
  return {
    name: 'About this export',
    rows: [
      { Field: 'Chama', Value: settings?.chamaName || '' },
      { Field: 'Report', Value: name },
      ...counts.map(([Field, Value]) => ({ Field, Value })),
      { Field: 'Generated on', Value: new Date() },
      { Field: 'Prepared by', Value: req.user?.name || '' },
      ...(notes ? [{ Field: 'What this counts', Value: notes }] : []),
    ],
  };
}

// GET /api/reports/export — all contributions with member names, .xlsx workbook
async function exportContributions(req, res, next) {
  try {
    const contributions = await Contribution.find({ deleted: false })
      .sort({ date: 1, createdAt: 1 })
      .populate('memberId', 'name phone regNumber')
      .populate('loggedBy', 'name')
      .populate('typeId', 'name')
      .lean();

    const sheetRows = contributions.map((c) => ({
      Date: new Date(c.date).toISOString().slice(0, 10),
      Member: c.memberId?.name || 'Unknown',
      'Reg number': c.memberId?.regNumber || '',
      Phone: c.memberId?.phone || '',
      Type: c.typeId?.name || '',
      Amount: c.amount,
      Method: c.method,
      Note: c.note || '',
      'Logged by': c.loggedBy?.name || '',
    }));
    sendWorkbook(res, 'contributions.xlsx', [
      aboutSheet({
        name: 'Contribution history',
        settings: await getOrCreateSettings(),
        req,
        counts: [['Contribution rows', sheetRows.length]],
        notes:
          'Every contribution row logged in this ledger, oldest first. Money carried forward ' +
          'from the paper ledger is not a row and is not in this sheet, so the total here is ' +
          'what this ledger has watched come in.',
      }),
      { name: 'Contributions', rows: sheetRows },
    ]);
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/audit-log?page=&limit=
async function auditLog(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    // Only the fields this screen prints. The stored `before`/`after` are full
    // document snapshots — a member's whole record, including his national ID, his
    // family and his next of kin — and shipping a hundred of those to a client to
    // render one amount next to a name is both slow and a needless second copy of
    // the register.
    const [entries, total] = await Promise.all([
      AuditLog.find()
        .select('action entityType entityId performedBy createdAt after.amount after.name before.amount before.name')
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

// GET /api/reports/weekly — chama-wide week-by-week reconciliation (expected vs actual)
async function weekly(req, res, next) {
  try {
    res.json({ weeks: await computeWeeklyReconciliation() });
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/weekly/export — same data as an .xlsx workbook, one row per week × type
async function exportWeekly(req, res, next) {
  try {
    const weeks = await computeWeeklyReconciliation();
    const overviewRows = weeks.map((w) => ({
      Week: w.weekNumber,
      'Start date': w.startDate.toISOString().slice(0, 10),
      'End date': w.endDate.toISOString().slice(0, 10),
      // The members' own money first: it is the figure the week is judged on.
      'Member contributions': w.memberTotal,
      'Members paid': w.memberPaidCount,
      'Members eligible': w.memberEligibleCount,
      'Group funds': w.groupFundTotal,
      Expected: w.expectedTotal,
      Actual: w.actualTotal,
      Diff: w.diff,
      'Members short': w.shortfallCount,
      'All paid': w.balanced ? 'Yes' : 'No',
    }));

    const shortfallRows = [];
    const paidRows = [];
    for (const w of weeks) {
      for (const t of w.types) {
        for (const m of t.shortfallMembers) {
          shortfallRows.push({
            Week: w.weekNumber,
            Type: t.typeName,
            Member: m.name,
            'Reg number': m.regNumber || '',
            Status: m.status,
            Paid: m.paid,
            Expected: t.weeklyAmount,
          });
        }
        // The other half of the same week, so the workbook names both sides the
        // way the screen does: a shortfall sheet on its own leaves a week's
        // collected money unattributed — every name on it reads zero.
        for (const m of t.paidMembers || []) {
          paidRows.push({
            Week: w.weekNumber,
            Type: t.typeName,
            Member: m.name,
            'Reg number': m.regNumber || '',
            Status: 'paid',
            Paid: m.paid,
            Expected: t.weeklyAmount,
          });
        }
      }
    }

    sendWorkbook(res, 'weekly-reconciliation.xlsx', [
      aboutSheet({
        name: 'Weekly reconciliation',
        settings: await getOrCreateSettings(),
        req,
        counts: [
          ['Weeks covered', weeks.length],
          ['Shortfall rows', shortfallRows.length],
          ['Paid-in-full rows', paidRows.length],
        ],
        notes:
          'Expected versus actual, week by week, per fixed weekly fund. The opening week expects ' +
          'nothing (every member\u2019s money for it is already carried forward) and the week still ' +
          'running is not scored. A week is "short" when at least one eligible member still owes ' +
          'their weekly minimum; "Paid in full" names the members who met it, with what each of ' +
          'them put in, so the two sheets together account for every eligible member.',
      }),
      { name: 'Weeks', rows: overviewRows },
      { name: 'Shortfalls', rows: shortfallRows },
      { name: 'Paid in full', rows: paidRows },
    ]);
  } catch (err) {
    next(err);
  }
}

// Month helpers. The group's calendar is Kenya (UTC+3), and the label is built
// from a fixed list rather than a locale, so the chart reads the same on every
// phone regardless of the language the device is set to.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHART_MONTHS = 12;

function monthKeyOf(date) {
  const shifted = new Date(new Date(date).getTime() + 3 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabelOf(key) {
  const [year, month] = key.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year.slice(2)}`;
}

// The last 12 month keys, oldest first, ending on the month it is now in Kenya.
function lastMonthKeys() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const keys = [];
  for (let back = CHART_MONTHS - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

// One member's own history — what the chart on his row of the performance report
// draws. Personal money only: the Tea Fund is collected from everyone
// automatically, so including it would credit him with effort he never made.
async function computeMemberReport(memberId) {
  const [member, types, excludedTypeIds, settings] = await Promise.all([
    Member.findById(memberId).lean(),
    ContributionType.find().select('name isWeekly isGroupFund active').lean(),
    nonPersonalTypeIds(),
    getOrCreateSettings(),
  ]);
  if (!member) return null;

  const rows = await Contribution.find({ memberId: member._id, deleted: false })
    .select('typeId amount grossAmount date')
    .lean();

  const typeById = new Map(types.map((t) => [String(t._id), t]));
  const excludedSet = new Set(excludedTypeIds.map(String));
  const config = resolveConfig(settings);

  const byMonth = new Map();
  const byType = new Map();
  let personalTotal = 0;
  let groupFundTotal = 0;
  let otherTotal = 0;
  let lastContributionDate = null;

  for (const row of rows) {
    const type = typeById.get(String(row.typeId));
    const isGroupFund = Boolean(type && type.isGroupFund);
    // grossAmount preferred, exactly as the ledger does: a payment partly
    // redirected to settle a fine was still cash received.
    const cash = Number(row.grossAmount ?? row.amount) || 0;

    // A row that is neither his own money nor a group fund is a system row (an
    // opening balance, interest). Counted so it can be named, never shown as his.
    const bucket = isGroupFund ? 'group' : excludedSet.has(String(row.typeId)) ? 'other' : 'personal';
    if (bucket === 'personal') personalTotal += cash;
    else if (bucket === 'group') groupFundTotal += cash;
    else otherTotal += cash;

    const key = monthKeyOf(row.date);
    if (!byMonth.has(key)) byMonth.set(key, { personal: 0, groupFund: 0, other: 0, count: 0 });
    const month = byMonth.get(key);
    month[bucket] += cash;
    month.count += 1;

    const typeName = type?.name || 'Uncategorised';
    const typeEntry = byType.get(typeName) || { name: typeName, total: 0, isGroupFund };
    typeEntry.total += cash;
    byType.set(typeName, typeEntry);

    const at = new Date(row.date).getTime();
    if (!lastContributionDate || at > new Date(lastContributionDate).getTime()) {
      lastContributionDate = row.date;
    }
  }

  // A continuous 12-month series: a month he missed shows as zero rather than
  // being skipped, which is the whole point of looking at a chart.
  const months = lastMonthKeys().map((key) => {
    const found = byMonth.get(key);
    return {
      month: key,
      label: monthLabelOf(key),
      personal: found ? found.personal : 0,
      groupFund: found ? found.groupFund : 0,
      other: found ? found.other : 0,
      total: found ? found.personal + found.groupFund + found.other : 0,
      count: found ? found.count : 0,
    };
  });

  // Consistency, by exactly the rule the performance table uses: the baseline
  // week and the week still running are not scored.
  const personalWeeklyTypes = types.filter((t) => t.isWeekly && !t.isGroupFund && t.active !== false);
  let weeksExpected = 0;
  let weeksPaid = 0;
  let weeksPartial = 0;
  let weeksUnpaid = 0;
  for (const type of personalWeeklyTypes) {
    const typeContributions = rows.filter((c) => String(c.typeId) === String(type._id));
    const weeks = buildWeeklySchedule(config, config.weeklyAmount, typeContributions);
    const scored = weeks.filter((w) => !w.isBaseline && !w.isCurrent);
    weeksExpected += scored.length;
    weeksPaid += scored.filter((w) => w.status === 'paid').length;
    weeksPartial += scored.filter((w) => w.status === 'partial').length;
    weeksUnpaid += scored.filter((w) => w.status === 'unpaid').length;
  }

  return {
    member: {
      id: member._id,
      name: member.name,
      regNumber: member.regNumber || null,
      phone: member.phone,
      photoUrl: member.photoUrl || '',
      active: member.active !== false,
      joinDate: member.joinDate || member.createdAt || null,
    },
    months,
    byType: [...byType.values()].sort((a, b) => b.total - a.total),
    totals: {
      personal: personalTotal,
      groupFund: groupFundTotal,
      other: otherTotal,
      all: personalTotal + groupFundTotal + otherTotal,
      carriedIn: Number(member.openingBalance) || 0,
      contributionCount: rows.length,
      lastContributionDate,
    },
    weekly: {
      weeksExpected,
      weeksPaid,
      weeksPartial,
      weeksUnpaid,
      consistency: weeksExpected > 0 ? Math.round((weeksPaid / weeksExpected) * 100) : null,
    },
  };
}

// The headings a committee reads above the ranking: how many members, what they
// have paid between them, how consistent they are, and what is still owed.
function performanceTotals(rows) {
  const scored = rows.filter((r) => r.consistency !== null);
  return {
    members: rows.length,
    totalContributed: rows.reduce((sum, r) => sum + r.totalContributed, 0),
    carriedIn: rows.reduce((sum, r) => sum + r.carriedIn, 0),
    averageConsistency: scored.length
      ? Math.round(scored.reduce((sum, r) => sum + r.consistency, 0) / scored.length)
      : null,
    fullyPaidMembers: scored.filter((r) => r.consistency === 100).length,
    membersBehind: scored.filter((r) => r.consistency < 80).length,
    pendingFines: rows.reduce((sum, r) => sum + r.pendingFines, 0),
    weeksPaid: rows.reduce((sum, r) => sum + r.weeksPaid, 0),
    weeksExpected: rows.reduce((sum, r) => sum + r.weeksExpected, 0),
  };
}

// GET /api/reports/trend?weeks=12 — the last N weeks, oldest first, for the trend
// chart the summary opens with: what the members put in each week, what the funds
// took alongside them, and how many were still short when the week closed.
async function trend(req, res, next) {
  try {
    const wanted = Math.min(52, Math.max(4, parseInt(req.query.weeks, 10) || 12));
    const weeks = await computeWeeklyReconciliation();
    // computeWeeklyReconciliation() answers newest-first (that is how the weekly
    // screen reads); a chart reads left to right.
    const recent = weeks.slice(0, wanted).reverse();

    res.json({
      weeks: recent.map((w) => ({
        weekNumber: w.weekNumber,
        startDate: w.startDate,
        endDate: w.endDate,
        label: `Wk ${w.weekNumber}`,
        memberTotal: w.memberTotal,
        groupFundTotal: w.groupFundTotal,
        total: w.memberTotal + w.groupFundTotal,
        expected: w.memberExpected,
        memberPaidCount: w.memberPaidCount,
        memberEligibleCount: w.memberEligibleCount,
        shortfallCount: w.shortfallCount,
        balanced: w.balanced,
        isBaseline: w.isBaseline,
        isCurrent: w.isCurrent,
      })),
    });
  } catch (err) {
    next(err);
  }
}


// The group's fines, in the three cuts the office asks for by name: what has been
// issued and what is still owed in total, which fine types carry the debt, who owes
// it, and how it has moved month by month.
async function computeFinesReport() {
  const [totals, byType, byMember, byMonth] = await Promise.all([
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
    Fine.aggregate([
      { $match: { deleted: false, remaining: { $gt: 0 } } },
      { $group: { _id: '$memberId', outstanding: { $sum: '$remaining' }, fines: { $sum: 1 } } },
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
          outstanding: 1,
          fines: 1,
        },
      },
      { $sort: { outstanding: -1 } },
      { $limit: 100 },
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
  ]);

  const head = totals[0] || { issued: 0, outstanding: 0, count: 0, pendingCount: 0 };

  return {
    totals: {
      issued: head.issued,
      outstanding: head.outstanding,
      cleared: head.issued - head.outstanding,
      count: head.count,
      pendingCount: head.pendingCount,
      clearedCount: head.count - head.pendingCount,
    },
    byType,
    byMember,
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
      { name: 'By member', rows: report.byMember.map(({ memberId, ...row }) => row) },
      { name: 'By month', rows: report.byMonth },
    ]);
  } catch (err) {
    next(err);
  }
}

// GET /api/reports/member/:id — one member's own report, for the chart the
// performance list opens when a member is tapped.
async function memberReport(req, res, next) {
  try {
    const report = await computeMemberReport(req.params.id);
    if (!report) return res.status(404).json({ message: 'Member not found' });
    res.json(report);
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
  weekly,
  exportWeekly,
  trend,
  finesReport,
  exportFinesReport,
  memberReport,
};