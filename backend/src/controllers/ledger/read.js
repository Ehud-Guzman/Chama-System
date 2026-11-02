// The treasurer's ledger controller, part: read. controllers/ledgerController.js is the index the routes use.

const Member = require('../../models/Member');
const ContributionType = require('../../models/ContributionType');
const Contribution = require('../../models/Contribution');
const mongoose = require('mongoose');
const Expense = require('../../models/Expense');
const Fine = require('../../models/Fine');
const { getOrCreateSettings } = require('../../utils/settings');
const { resolveConfig, currentWeekNumber, weekRange, cycleHistory, cycleWeekNumber, weekNumberForDate } = require('../../utils/weekCycle');
const { bucketForType } = require('../../utils/ledgerTypes');
const { computeMemberLedger, summariseMember, totalLedger } = require('../../utils/memberLedger');
const { teaMemberWeeks } = require('../../utils/teaCharges');
const { fundBalance } = require('../../utils/fundBalance');
const { buildLedgerWalk } = require('../../utils/ledgerWalk');

// Loads the settings + the annotated contribution list every ledger view needs.
// Contributions arrive tagged with their bucket so nothing downstream has to
// know type names, and grossAmount is preferred so a payment that was partly
// redirected to a fine still counts as cash received.
async function loadContext(memberFilter) {
  const settings = await getOrCreateSettings();
  const config = resolveConfig(settings);

  const members = await Member.find(memberFilter).sort({ name: 1 }).lean();
  const memberIds = members.map((m) => m._id);

  const [types, contributions] = await Promise.all([
    ContributionType.find()
      .select('name isWeekly isGroupFund tracksExpenses active openingBalance openingBalanceNote')
      .lean(),
    memberIds.length === 0
      ? Promise.resolve([])
      : Contribution.find({ memberId: { $in: memberIds }, deleted: false })
          // `fineDeducted` rides along because the member's walk names it on the row ("Ksh 400 of
          // this cleared his fines") — the ledger follows cash in, so a reader owed that sentence.
          .select('memberId typeId amount grossAmount fineDeducted date method note createdAt')
          .sort({ date: -1, createdAt: -1 })
          .lean(),
  ]);

  const typeById = new Map(types.map((t) => [String(t._id), t]));
  const annotated = contributions.map((c) => {
    const type = typeById.get(String(c.typeId));
    return {
      ...c,
      bucket: bucketForType(type),
      isGroupFund: Boolean(type && type.isGroupFund),
      typeName: type ? type.name : '',
    };
  });

  const byMember = new Map();
  for (const c of annotated) {
    const key = String(c.memberId);
    if (!byMember.has(key)) byMember.set(key, []);
    byMember.get(key).push(c);
  }

  return { settings, config, members, byMember, types };
}

// GET /api/ledger — the member list the treasurer lands on: one row per active
// member with his money, what the cycle expects of him, and his tea figure.
async function listLedger(req, res, next) {
  try {
    const { config, members, byMember } = await loadContext({ active: true });

    const ledgers = members.map((member) =>
      computeMemberLedger({
        member,
        contributions: byMember.get(String(member._id)) || [],
        config,
      })
    );

    res.json({
      week: {
        currentWeek: currentWeekNumber(config),
        cycleStartWeek: config.cycleStartWeek,
        ...weekRange(currentWeekNumber(config), config),
        weeklyAmount: config.weeklyAmount,
        chaiAmount: config.chaiAmount,
      },
      members: members.map((m, i) => summariseMember(m, ledgers[i])),
      totals: totalLedger(ledgers),
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/ledger/members/:id — one member's full ledger: the week-by-week
// rows, every log he has with its note, and the Tea Fund spending it sits
// against.
async function memberLedger(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: 'Member not found' });
    }
    const member = await Member.findById(req.params.id).lean();
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const { config, byMember, types } = await loadContext({ _id: member._id });
    const contributions = byMember.get(String(member._id)) || [];
    const ledger = computeMemberLedger({ member, contributions, config });

    // The fund types come out of the type list loadContext already fetched, so
    // this page costs one round trip for the member and one for the fund — see
    // the settings cache for why round trips are the thing worth counting.
    const fundTypes = types.filter((t) => t.tracksExpenses && t.active);
    const fundTypeIds = fundTypes.map((t) => t._id);
    const chaiType = types.find((t) => bucketForType(t) === 'chai') || null;
    const [activeMembers, expenses, teaBeforeCycle, fines] = await Promise.all([
      Member.countDocuments({ active: true }),
      fundTypeIds.length === 0
        ? Promise.resolve([])
        : Expense.find({ typeId: { $in: fundTypeIds }, deleted: false })
            .sort({ date: -1, createdAt: -1 })
            .limit(25)
            .populate('typeId', 'name')
            .populate('loggedBy', 'name')
            .lean(),
      // Tea collected before the books opened — the one-time week-91 entry — is
      // real income for the Tea Fund and is not part of the automatic figure,
      // which only starts with the first scored week.
      chaiType
        ? Contribution.aggregate([
            { $match: { deleted: false, typeId: chaiType._id, date: { $lt: config.anchorDate } } },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$grossAmount', '$amount'] } } } },
          ])
        : Promise.resolve([]),
      // His fines, for the walk's own column. Loaded on this page rather than only on the member
      // record because "how did the figure get here?" has to answer the fine he was charged and the
      // payment that cleared it too — and this is the screen he sits in front of with the treasurer.
      Fine.find({ memberId: member._id, deleted: false })
        .sort({ date: 1 })
        .populate('typeId', 'name')
        .lean(),
    ]);
    // The Tea Fund's income is automatic — 100 per member per scored week of the
    // cycle, the opening week taking none — so it is derived here rather than
    // summed from contribution rows, plus whatever tea was collected before the
    // cycle opened.
    // Worked out for the whole group, not from this member's own ledger: a member who has left has his
    // ledger read as at the day he left, and the group's tea is not his.
    const teaIncome = config.chaiAmount * (await teaMemberWeeks(config, { activeMembers })) + (teaBeforeCycle[0]?.total || 0);
    const balances = await Promise.all(
      fundTypes.map((t) =>
        fundBalance(t._id, {
          extraIncome: bucketForType(t) === 'chai' ? teaIncome : 0,
          // The fund's one-time carry-in, entered on the go-live screen: without
          // it the Tea Fund (and any other fund) would read as if the group had
          // only ever collected what this ledger has seen.
          carriedIn: t.openingBalance,
        })
      )
    );

    res.json({
      member: summariseMember(member, ledger),
      ledger,
      // The same figures, one step at a time — what the panel behind "Show the working" prints. The
      // rows it walks are the same annotated logs returned below, so the working and the figures it
      // explains are built from one set of rows (utils/ledgerWalk).
      walk: buildLedgerWalk({ member, contributions, fines, config }),
      week: {
        currentWeek: ledger.currentWeek,
        cycleStartWeek: config.cycleStartWeek,
        ...weekRange(ledger.currentWeek, config),
      },
      // Weeks 1..(cycleStartWeek-1) — the group's whole history, so the week list
      // reads back to week one with every Thursday in place, even though only the
      // live weeks carry an expectation. Any that were collected (the one-time
      // week-91 entry) carry their figures, so the money shows against the week it
      // was collected in.
      history: withHistoryPaid(cycleHistory(config), ledger.historyPaid),
      // Each log carries the week it falls in so the list can be read the same
      // way the paper ledger was — by week, not just by date. The unclamped week
      // is kept alongside so a payment from before the cycle is not displayed as
      // if it were collected in week 92.
      logs: contributions.map((c) => ({
        ...c,
        week: cycleWeekNumber(c.date, config),
        collectedWeek: weekNumberForDate(c.date, config),
      })),
      funds: fundTypes.map((t, i) => ({
        typeId: t._id,
        name: t.name,
        ...balances[i],
      })),
      expenses,
    });
  } catch (err) {
    next(err);
  }
}

// The week list's history rows with the money collected in them attached — the
// one-time week-91 entry. Weeks nobody collected in are returned untouched.
function withHistoryPaid(history, historyPaid) {
  if (!historyPaid || historyPaid.length === 0) return history;
  const byWeek = new Map(historyPaid.map((h) => [h.weekNumber, h]));
  return history.map((w) => {
    const hit = byWeek.get(w.weekNumber);
    return hit ? { ...w, paid: hit.paid, chaiPaid: hit.chaiPaid } : w;
  });
}

module.exports = {
  listLedger,
  memberLedger,
};
