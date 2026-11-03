// The reports controller, part: member. controllers/reportController.js is the index the routes use.

const Member = require('../../models/Member');
const ContributionType = require('../../models/ContributionType');
const Contribution = require('../../models/Contribution');
const { nonPersonalTypeIds } = require('../../utils/personalTypes');
const { getOrCreateSettings } = require('../../utils/settings');
const { resolveConfig, weeklyAmountForWeek } = require('../../utils/weekCycle');
const { buildWeeklySchedule } = require('../../utils/weeklySchedule');

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
    const weeks = buildWeeklySchedule(config, (w) => weeklyAmountForWeek(config, w), typeContributions);
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
  memberReport,
};
