const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const { getOrCreateSettings } = require('./settings');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Chama-wide week-by-week reconciliation: for every fixed weekly
// contribution type (Weekly Contribution, Chai, ...), compares what was
// actually collected against what was expected from every member who had
// already joined by that week, so a treasurer can spot exactly which week
// came up short (or over) without re-adding a physical ledger by hand.
//
// Every member is expected to share the same joinDate anchor once imported
// from the paper ledger (see importWeek60Ledger.js), so week boundaries line
// up chama-wide the same way buildWeeklySchedule lines them up per member —
// this just aggregates that same grid across everyone at once.
async function computeWeeklyReconciliation() {
  const [members, weeklyTypes, settings] = await Promise.all([
    Member.find({ active: true }).select('name regNumber joinDate resignedAt').lean(),
    // Group-fund weekly "types" like Chai are a flat deduction taken from
    // everyone regardless of choice (see importWeek61Ledger.js), never an
    // optional per-member payment — so there's no such thing as a member
    // individually "not paying" it. Scoring it the same way as the real
    // 1,400 Weekly Contribution would flag all 32 members as unpaid, every
    // week, forever. Only personal weekly types are reconciled here.
    ContributionType.find({ isWeekly: true, isGroupFund: false, active: true })
      .select('name weeklyAmount isGroupFund')
      .lean(),
    getOrCreateSettings(),
  ]);

  if (members.length === 0 || weeklyTypes.length === 0) return [];

  const anchorTime = Math.min(...members.map((m) => new Date(m.joinDate).getTime()));
  const weekCount = Math.max(1, Math.floor((Date.now() - anchorTime) / WEEK_MS) + 1);
  // Weeks before this stay out of the chama-wide view entirely — week
  // numbers still count from each member's true join date (so "Week 61"
  // here always matches "Week 61" on the paper ledger), we just skip
  // rendering/scoring the pre-tracking weeks nobody can reconcile.
  const trackingStartMs = settings.weeklyTrackingStartDate
    ? new Date(settings.weeklyTrackingStartDate).getTime()
    : anchorTime;

  const memberIds = members.map((m) => m._id);
  const typeIds = weeklyTypes.map((t) => t._id);

  const contributions = await Contribution.find({
    memberId: { $in: memberIds },
    typeId: { $in: typeIds },
    deleted: false,
  })
    .select('memberId typeId amount grossAmount date')
    .lean();

  const weeks = [];
  for (let i = 0; i < weekCount; i++) {
    const startDate = new Date(anchorTime + i * WEEK_MS);
    const endDate = new Date(anchorTime + (i + 1) * WEEK_MS - 1);
    // A week only counts as "trackable" once it starts on or after the
    // configured cutoff — comparing against endDate would let the last
    // pre-tracking week (which ends just hours into the cutoff day, since
    // week boundaries inherit the sheet's own time-of-day) slip through.
    if (startDate.getTime() < trackingStartMs) continue;
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();

    const weekContribs = contributions.filter((c) => {
      const t = new Date(c.date).getTime();
      return t >= startMs && t <= endMs;
    });

    // A member only owes for a week once they've actually joined, and stops
    // owing the week they resign.
    const eligibleMembers = members.filter((m) => {
      const joined = new Date(m.joinDate).getTime() <= startMs;
      const stillIn = !m.resignedAt || new Date(m.resignedAt).getTime() > startMs;
      return joined && stillIn;
    });
    const eligibleIds = new Set(eligibleMembers.map((m) => String(m._id)));

    const types = weeklyTypes.map((type) => {
      const typeContribs = weekContribs.filter((c) => String(c.typeId) === String(type._id));
      const paidByMember = new Map();
      for (const c of typeContribs) {
        const key = String(c.memberId);
        const amt = c.grossAmount ?? c.amount;
        paidByMember.set(key, (paidByMember.get(key) || 0) + amt);
      }

      const actual = [...paidByMember.values()].reduce((s, v) => s + v, 0);
      const expected = eligibleMembers.length * type.weeklyAmount;

      const shortfallMembers = eligibleMembers
        .map((m) => {
          const paid = paidByMember.get(String(m._id)) || 0;
          const status = paid >= type.weeklyAmount ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
          return { memberId: m._id, name: m.name, regNumber: m.regNumber || null, paid, status };
        })
        .filter((m) => m.status !== 'paid');

      // Contributions logged against members who weren't eligible that week
      // (e.g. backdated opening-balance entries) still count toward actual
      // collected cash, but shouldn't be blamed on any "unpaid" member.
      const untrackedAmount = [...paidByMember.entries()]
        .filter(([memberId]) => !eligibleIds.has(memberId))
        .reduce((s, [, amt]) => s + amt, 0);

      return {
        typeId: type._id,
        typeName: type.name,
        isGroupFund: type.isGroupFund,
        weeklyAmount: type.weeklyAmount,
        eligibleCount: eligibleMembers.length,
        expected,
        actual,
        diff: actual - expected,
        untrackedAmount,
        shortfallMembers,
      };
    });

    const expectedTotal = types.reduce((s, t) => s + t.expected, 0);
    const actualTotal = types.reduce((s, t) => s + t.actual, 0);

    weeks.push({
      weekNumber: i + 1,
      startDate,
      endDate,
      isCurrent: i === weekCount - 1,
      expectedTotal,
      actualTotal,
      diff: actualTotal - expectedTotal,
      balanced: actualTotal === expectedTotal,
      types,
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
