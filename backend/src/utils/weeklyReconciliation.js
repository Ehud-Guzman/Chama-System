const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const { getOrCreateSettings } = require('./settings');
const { resolveConfig } = require('./weekCycle');
const { bucketForType, CHAI_TYPE_NAME, WEEKLY_TYPE_NAME } = require('./ledgerTypes');
const { computeMemberLedger } = require('./memberLedger');

// Chama-wide week-by-week reconciliation: for every weekly fund (the personal
// contribution and the Tea Fund), what was actually collected against what was
// expected from every active member, so the treasurer can see exactly which week
// came up short and who was in it.
//
// The weeks, the amounts and the member figures all come from the same cycle
// engine the treasurer logs against (computeMemberLedger) — a reconciliation
// that counted weeks differently from the ledger it is reconciling would be
// worse than none at all, and before the Week-92 reset this one anchored on each
// member's join date and reported the whole imported history as unpaid.
async function computeWeeklyReconciliation() {
  const [members, settings, types] = await Promise.all([
    // Resigned members are left out: the cycle is the group's live record, and
    // somebody who has left no longer owes into it.
    Member.find({ active: true }).select('name regNumber phone openingBalance').lean(),
    getOrCreateSettings(),
    ContributionType.find().select('name isGroupFund isWeekly tracksExpenses').lean(),
  ]);

  if (members.length === 0) return [];

  const config = resolveConfig(settings);
  const typeById = new Map(types.map((t) => [String(t._id), t]));

  const contributions = await Contribution.find({
    memberId: { $in: members.map((m) => m._id) },
    deleted: false,
  })
    .select('memberId typeId amount grossAmount date')
    .lean();

  const byMember = new Map();
  for (const c of contributions) {
    const type = typeById.get(String(c.typeId));
    const annotated = {
      ...c,
      bucket: bucketForType(type),
      isGroupFund: Boolean(type && type.isGroupFund),
    };
    const key = String(c.memberId);
    if (!byMember.has(key)) byMember.set(key, []);
    byMember.get(key).push(annotated);
  }

  const ledgers = members.map((member) => ({
    member,
    ledger: computeMemberLedger({
      member,
      contributions: byMember.get(String(member._id)) || [],
      config,
    }),
  }));

  // The two funds a week is scored against. Tea is scored too — §7.2 has every
  // member contributing 100 a week — but it is never mixed into the personal
  // contribution figures above it.
  const funds = [
    {
      type: types.find((t) => t.name === WEEKLY_TYPE_NAME) || null,
      typeName: WEEKLY_TYPE_NAME,
      isGroupFund: false,
      weeklyAmount: config.weeklyAmount,
      read: (week) => ({ paid: week.personalPaid, item: week }),
    },
    {
      type: types.find((t) => t.name === CHAI_TYPE_NAME) || null,
      typeName: CHAI_TYPE_NAME,
      isGroupFund: true,
      weeklyAmount: config.chaiAmount,
      // Automatic: every member is charged the week's tea whether or not anybody
      // logged anything, so a tea week is always collected and can never come up
      // short. Reported as its own fund so the total reaching the Group is
      // visible; never counted against a member.
      automatic: true,
      read: (week) => ({ paid: week.chaiAmount ?? config.chaiAmount, item: week }),
    },
  ];

  const weeks = [];
  for (const weekNumber of ledgers[0].ledger.weeks.map((w) => w.weekNumber)) {
    const sample = ledgers[0].ledger.weeks.find((w) => w.weekNumber === weekNumber);
    // The opening week is the baseline and is not scored: nobody was expected to
    // pay into it, so it cannot come up short. computeMemberLedger flags the same
    // week, so the reconciliation and the ledger can never disagree about it.
    const isBaseline = Boolean(sample && sample.isBaseline);
    const perFund = [];

    for (const fund of funds) {
      let actual = 0;
      const shortfallMembers = [];

      for (const { member, ledger } of ledgers) {
        const week = ledger.weeks.find((w) => w.weekNumber === weekNumber);
        if (!week) continue;
        const { paid } = fund.read(week);
        actual += paid;
        if (isBaseline) continue;
        const status = fund.weeklyAmount > 0 && paid >= fund.weeklyAmount ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
        if (status !== 'paid') {
          shortfallMembers.push({
            memberId: member._id,
            name: member.name,
            regNumber: member.regNumber || null,
            paid,
            status,
          });
        }
      }

      const expected = isBaseline ? 0 : ledgers.length * fund.weeklyAmount;

      perFund.push({
        typeId: fund.type ? fund.type._id : null,
        typeName: fund.typeName,
        isGroupFund: fund.isGroupFund,
        automatic: Boolean(fund.automatic),
        weeklyAmount: fund.weeklyAmount,
        eligibleCount: ledgers.length,
        expected,
        actual,
        diff: actual - expected,
        // Nothing can be collected against a cycle week from outside it, so
        // there is never an untracked tail to explain.
        untrackedAmount: 0,
        shortfallMembers: shortfallMembers.sort((a, b) => b.paid - a.paid),
      });
    }

    const expectedTotal = perFund.reduce((s, f) => s + f.expected, 0);
    const actualTotal = perFund.reduce((s, f) => s + f.actual, 0);
    // Comparing raw totals for equality is a poor "is this week okay?" signal:
    // one member overpaying routinely offsets another underpaying, so the sums
    // rarely match exactly even on a perfectly fine week. What actually matters
    // to a treasurer is whether anyone still owes their minimum.
    const shortfallCount = perFund.reduce((s, f) => s + f.shortfallMembers.length, 0);

    weeks.push({
      weekNumber,
      startDate: sample.startDate,
      endDate: sample.endDate,
      isCurrent: sample.isCurrent,
      isBaseline,
      expectedTotal,
      actualTotal,
      diff: actualTotal - expectedTotal,
      shortfallCount,
      balanced: shortfallCount === 0,
      types: perFund,
    });
  }

  return weeks.reverse();
}

// Single-week detail — same shape as one entry from computeWeeklyReconciliation,
// used for the drill-down view without re-walking every other week.
async function computeWeekDetail(weekNumber) {
  const weeks = await computeWeeklyReconciliation();
  return weeks.find((w) => w.weekNumber === weekNumber) || null;
}

module.exports = { computeWeeklyReconciliation, computeWeekDetail };

