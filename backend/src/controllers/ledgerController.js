const mongoose = require('mongoose');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const Expense = require('../models/Expense');
const ContributionType = require('../models/ContributionType');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { getOrCreateSettings, invalidateSettings } = require('../utils/settings');
const {
  resolveConfig,
  currentWeekNumber,
  weekNumberForDate,
  weekRange,
  cycleWeekNumber,
  cycleHistory,
  fridayOf,
  parseEatDate,
  toEatDateString,
} = require('../utils/weekCycle');
const { getLedgerTypes, bucketForType, syncLedgerTypeAmounts } = require('../utils/ledgerTypes');
const { computeMemberLedger, summariseMember, totalLedger } = require('../utils/memberLedger');
const { suggestedOpeningBalances } = require('../utils/suggestedBalances');
const { fundBalance } = require('../utils/fundBalance');

const METHODS = ['cash', 'bank', 'mobile', 'other'];
// Everything the treasurer can put on a member's page. Tea is not here on
// purpose: it is automatic, so there is nothing to log and nothing to edit.
const LOG_KINDS = ['weekly', 'expense'];

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
          .select('memberId typeId amount grossAmount date method note createdAt')
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
    const [activeMembers, expenses, teaBeforeCycle] = await Promise.all([
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
    ]);
    // The Tea Fund's income is automatic — 100 per member per scored week of the
    // cycle, the opening week taking none — so it is derived here rather than
    // summed from contribution rows, plus whatever tea was collected before the
    // cycle opened.
    const teaIncome =
      config.chaiAmount * ledger.weeksScored * activeMembers + (teaBeforeCycle[0]?.total || 0);
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

// Shared validation for a new log line. Returns an error message or null.
function validateLog({ amount, date, method }) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 'Amount must be a number greater than zero';
  if (!METHODS.includes(method)) return 'Method must be one of: cash, bank, mobile, other';
  if (date !== undefined && date !== null && date !== '') {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return 'Invalid date';
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (d > endOfToday) return 'Date cannot be in the future';
  }
  return null;
}

// POST /api/ledger/members/:id/log — the one write the treasurer needs. Which
// collection it lands in is decided from the kind, so the UI can keep a single
// "Add a log" panel instead of a form per record type. `note` is free text and
// is where an M-Pesa or bank message gets pasted, kept on the entry itself so
// the evidence sits with the money it explains.
async function createLog(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: 'Member not found' });
    }
    const { kind, amount, date, method, note, description, fundTypeId, clientRequestId } = req.body || {};

    if (!LOG_KINDS.includes(kind)) {
      return res.status(400).json({ message: `Kind must be one of: ${LOG_KINDS.join(', ')}` });
    }
    const member = await Member.findOne({ _id: req.params.id, active: true });
    if (!member) return res.status(400).json({ message: 'Member not found or inactive' });

    const invalid = validateLog({ amount, date, method });
    if (invalid) return res.status(400).json({ message: invalid });
    const value = Number(amount);
    const when = date ? new Date(date) : new Date();
    const text = String(note || '').trim();

    // A retried submit (dropped response, two taps) resolves to the entry it
    // already created rather than logging the same payment twice.
    if (clientRequestId) {
      const existing = await Contribution.findOne({ clientRequestId }).lean();
      if (existing) return res.status(200).json({ entry: existing, replay: true });
    }

    const types = await getLedgerTypes();

    if (kind === 'expense') {
      const fund = fundTypeId ? await ContributionType.findById(fundTypeId) : types.chai;
      if (!fund || !fund.tracksExpenses) {
        return res.status(400).json({ message: 'Choose a fund that tracks expenses' });
      }
      const expense = await Expense.create({
        typeId: fund._id,
        amount: value,
        date: when,
        description: String(description || '').trim(),
        note: text,
        loggedBy: req.user._id,
      });
      await logAudit({
        action: 'create',
        entityType: 'Expense',
        entityId: expense._id,
        performedBy: req.user._id,
        after: snapshot(expense),
      });
      return res.status(201).json({ entry: expense, kind });
    }

    const type = kindsToType(kind, types);
    if (!type) {
      return res.status(400).json({ message: 'Ledger type missing — run the ledger setup again' });
    }

    let contribution;
    try {
      contribution = await Contribution.create({
        memberId: member._id,
        typeId: type._id,
        amount: value,
        date: when,
        method,
        note: text,
        loggedBy: req.user._id,
        clientRequestId: clientRequestId || undefined,
      });
    } catch (err) {
      if (err.code === 11000 && clientRequestId) {
        const existing = await Contribution.findOne({ clientRequestId }).lean();
        if (existing) return res.status(200).json({ entry: existing, replay: true });
      }
      throw err;
    }

    await logAudit({
      action: 'create',
      entityType: 'Contribution',
      entityId: contribution._id,
      performedBy: req.user._id,
      after: snapshot(contribution),
    });
    res.status(201).json({ entry: contribution, kind });
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

// POST /api/ledger/collect-week — the one-time bulk entry for a week that was
// collected in cash, for every member at once. Week 91 is the case it exists for:
// the week the paper ledger closed just before go-live, where every member paid
// the week's 1,400 and the week's 100 tea, and the treasurer should not have to
// hand-enter 32 pairs of rows.
//
// Two rows per member — the weekly contribution and the tea. The tea is logged
// rather than derived because the automatic deduction only covers scored weeks: a
// week before the cycle opened has no automatic figure behind it, and the engine
// counts tea logged for those weeks as the deduction it was.
//
// Every row carries a deterministic clientRequestId, so running this twice posts
// nothing the second time and a dropped response cannot double a member up.
// `dryRun` reports exactly what it would do without writing anything.
async function collectWeek(req, res, next) {
  try {
    const { weekNumber, weeklyAmount, chaiAmount, method = 'cash', note, dryRun } = req.body || {};
    const settings = await getOrCreateSettings();
    const config = resolveConfig(settings);

    const week = parseInt(weekNumber, 10);
    if (!Number.isInteger(week) || week < 1) {
      return res.status(400).json({ message: 'Week must be a whole number of at least 1' });
    }
    if (week > currentWeekNumber(config)) {
      return res.status(400).json({ message: 'That week has not started yet' });
    }

    const weekly = Number(weeklyAmount);
    if (!Number.isFinite(weekly) || weekly <= 0) {
      return res.status(400).json({ message: 'The weekly amount must be greater than zero' });
    }
    const chai =
      chaiAmount === undefined || chaiAmount === null || chaiAmount === '' ? 0 : Number(chaiAmount);
    if (!Number.isFinite(chai) || chai < 0) {
      return res.status(400).json({ message: 'The tea amount cannot be negative' });
    }
    if (!METHODS.includes(method)) {
      return res.status(400).json({ message: `Method must be one of: ${METHODS.join(', ')}` });
    }

    const types = await getLedgerTypes();
    if (!types.weekly) {
      return res.status(400).json({ message: 'Ledger type missing — run the ledger setup again' });
    }
    if (chai > 0 && !types.chai) {
      return res.status(400).json({ message: 'Tea type missing — run the ledger setup again' });
    }

    // Dated on the Thursday the week closed, at midnight EAT, so the rows land in
    // the week they belong to on every screen rather than on today's date.
    const range = weekRange(week, config);
    const when = parseEatDate(toEatDateString(range.endDate));
    const text = String(note || '').trim() || `Week ${week} collection — posted in one go`;

    const members = await Member.find({ active: true }).sort({ name: 1 }).select('_id name').lean();
    const planned = members.map((member) => ({
      member,
      weeklyId: `week${week}-${member._id}-weekly`,
      chaiId: `week${week}-${member._id}-chai`,
    }));

    // Idempotency is per member, not per batch: a member already posted is left
    // alone, so a run that died halfway can simply be run again.
    const existing = await Contribution.find({
      clientRequestId: { $in: planned.flatMap((p) => [p.weeklyId, p.chaiId]) },
    })
      .select('clientRequestId')
      .lean();
    const already = new Set(existing.map((e) => e.clientRequestId));

    const toPost = planned.filter((p) => !already.has(p.weeklyId));
    const summary = {
      weekNumber: week,
      date: when,
      members: members.length,
      posted: toPost.length,
      skipped: members.length - toPost.length,
      perMember: { weekly, chai },
      totals: {
        weekly: toPost.length * weekly,
        chai: toPost.length * chai,
        cash: toPost.length * weekly + toPost.length * chai,
      },
    };

    if (dryRun) {
      return res.json({
        ...summary,
        dryRun: true,
        membersAffected: toPost.map((p) => p.member.name),
      });
    }

    for (const { member, weeklyId, chaiId } of toPost) {
      await Contribution.create({
        memberId: member._id,
        typeId: types.weekly._id,
        amount: weekly,
        date: when,
        method,
        note: text,
        loggedBy: req.user._id,
        clientRequestId: weeklyId,
      });
      if (chai > 0) {
        await Contribution.create({
          memberId: member._id,
          typeId: types.chai._id,
          amount: chai,
          date: when,
          method,
          note: text,
          loggedBy: req.user._id,
          clientRequestId: chaiId,
        });
      }
    }

    // One entry for the batch rather than 64 per-row entries: a group-wide
    // maintenance action belongs to the System entity, the same way a reset does,
    // and the summary carries the member ids and the totals so the trail is whole.
    await logAudit({
      action: 'create',
      entityType: 'System',
      entityId: settings._id,
      performedBy: req.user._id,
      after: { action: 'collect-week', ...summary, memberIds: toPost.map((p) => String(p.member._id)) },
    });

    res.status(201).json(summary);
  } catch (err) {
    next(err);
  }
}

// Which bucket a log kind writes to. Tea has no kind: it is deducted
// automatically and never logged.
function kindsToType(kind, types) {
  if (kind === 'weekly') return types.weekly;
  return null;
}

// DELETE /api/ledger/collect-week?weekNumber=91 — takes a bulk entry back out
// again, for when the week or the amounts were wrong. Soft delete, like every
// other record, so the rows keep their trail and a mistake is one call away
// instead of a manual repair.
async function undoCollectWeek(req, res, next) {
  try {
    const week = parseInt(req.query.weekNumber, 10);
    if (!Number.isInteger(week) || week < 1) {
      return res.status(400).json({ message: 'Week must be a whole number of at least 1' });
    }
    const settings = await getOrCreateSettings();
    const result = await Contribution.updateMany(
      { clientRequestId: new RegExp(`^week${week}-`), deleted: false },
      { $set: { deleted: true } }
    );
    await logAudit({
      action: 'delete',
      entityType: 'System',
      entityId: settings._id,
      performedBy: req.user._id,
      before: { action: 'undo-collect-week', weekNumber: week, removed: result.modifiedCount },
    });
    res.json({ weekNumber: week, removed: result.modifiedCount });
  } catch (err) {
    next(err);
  }
}

// GET /api/ledger/setup — the one-off screen for the cycle figures and each
// member's opening balance. `suggested` is what the ledger currently says the
// member holds (his own money, group funds excluded) — the carry-forward the
// audit already worked out, offered so nobody has to retype 32 balances off a
// sheet. Nothing is saved until the treasurer confirms.
async function getSetup(req, res, next) {
  try {
    const settings = await getOrCreateSettings();
    const config = resolveConfig(settings);

    const [members, held, types, collectedByType, spentByType, activeMemberCount] = await Promise.all([
      Member.find().sort({ name: 1 }).lean(),
      suggestedOpeningBalances(),
      ContributionType.find().sort({ name: 1 }).lean(),
      Contribution.aggregate([
        { $match: { deleted: false } },
        { $group: { _id: '$typeId', total: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        { $match: { deleted: false } },
        { $group: { _id: '$typeId', total: { $sum: '$amount' } } },
      ]),
      Member.countDocuments({ active: true }),
    ]);
    const collectedMap = new Map(collectedByType.map((r) => [String(r._id), r.total]));
    const spentMap = new Map(spentByType.map((r) => [String(r._id), r.total]));
    // The Tea Fund's income is derived rather than logged, so what the ledger
    // already counts for it has to be worked out the same way the member page
    // works it out: the automatic 100 a member for every scored week.
    const scoredWeeks = Math.max(0, currentWeekNumber(config) - config.cycleStartWeek);
    const automaticTea = config.chaiAmount * scoredWeeks * activeMemberCount;

    res.json({
      settings: {
        chamaName: settings.chamaName,
        cycleStartWeek: config.cycleStartWeek,
        weeklyAmount: config.weeklyAmount,
        chaiAmount: config.chaiAmount,
        // The Friday as an EAT calendar date, so the date input shows the real
        // week boundary and saving it back lands on the same instant.
        weekAnchorDate: toEatDateString(config.anchorDate),
        weeklyTrackingStartDate: settings.weeklyTrackingStartDate,
      },
      week: {
        currentWeek: currentWeekNumber(config),
        ...weekRange(currentWeekNumber(config), config),
      },
      members: members.map((m) => ({
        _id: m._id,
        name: m.name,
        regNumber: m.regNumber || null,
        active: m.active,
        openingBalance: m.openingBalance || 0,
        openingBalanceNote: m.openingBalanceNote || '',
        // Rounded to the cent: a bank-interest line carried two decimal places
        // and nothing here needs more than that.
        suggested: Math.round((held.get(String(m._id)) || 0) * 100) / 100,
      })),
      // The group's funds, each with the one-time total it already held. Same idea
      // as a member's opening balance: the money was real before this ledger
      // existed, so it has to be keyed in once or every fund reads as empty.
      funds: types.map((t) => {
        const collected = collectedMap.get(String(t._id)) || 0;
        const spent = spentMap.get(String(t._id)) || 0;
        const derived = bucketForType(t) === 'chai' ? automaticTea : 0;
        const openingBalance = t.openingBalance || 0;
        return {
          typeId: t._id,
          name: t.name,
          description: t.description || '',
          isWeekly: Boolean(t.isWeekly),
          isGroupFund: Boolean(t.isGroupFund),
          tracksExpenses: Boolean(t.tracksExpenses),
          isRecoverable: Boolean(t.isRecoverable),
          active: t.active !== false,
          openingBalance,
          openingBalanceNote: t.openingBalanceNote || '',
          collected,
          derived,
          spent,
          // Where the fund stands today with its carry-in included — the figure to
          // check the paper book against.
          balance: openingBalance + collected + derived - spent,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/ledger/setup — cycle figures and/or the opening balances in one
// save, because they are always decided together at go-live.
async function updateSetup(req, res, next) {
  try {
    const settings = await getOrCreateSettings();
    const before = snapshot(settings);
    const { cycleStartWeek, weeklyAmount, chaiAmount, weekAnchorDate, balances, funds } =
      req.body || {};

    if (weeklyAmount !== undefined) {
      const n = Number(weeklyAmount);
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ message: 'Weekly amount must be greater than zero' });
      }
      settings.weeklyAmount = n;
    }
    if (chaiAmount !== undefined) {
      const n = Number(chaiAmount);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ message: 'Tea amount cannot be negative' });
      }
      settings.chaiAmount = n;
    }
    if (cycleStartWeek !== undefined) {
      const n = parseInt(cycleStartWeek, 10);
      if (!Number.isInteger(n) || n < 1) {
        return res.status(400).json({ message: 'Start week must be a whole number of at least 1' });
      }
      settings.cycleStartWeek = n;
    }
    if (weekAnchorDate !== undefined && weekAnchorDate !== null && weekAnchorDate !== '') {
      // Parsed as an EAT calendar date and normalised to its Friday — the anchor
      // is a week boundary, and a mid-week value would renumber every week
      // already on the ledger.
      settings.weekAnchorDate = fridayOf(parseEatDate(weekAnchorDate));
    }
    settings.updatedBy = req.user._id;
    await settings.save();
    invalidateSettings();
    // The legacy screens read each type's own weeklyAmount, so the copies are
    // refreshed whenever the authoritative figures change.
    await syncLedgerTypeAmounts(settings);

    await logAudit({
      action: 'update',
      entityType: 'Settings',
      entityId: settings._id,
      performedBy: req.user._id,
      before,
      after: snapshot(settings),
    });

    let saved = 0;
    if (Array.isArray(balances)) {
      for (const row of balances) {
        if (!row || !mongoose.Types.ObjectId.isValid(row.memberId)) continue;
        const amount = Number(row.openingBalance);
        if (!Number.isFinite(amount)) continue;
        const memberBefore = await Member.findById(row.memberId).lean();
        if (!memberBefore) continue;
        if ((memberBefore.openingBalance || 0) === amount && row.openingBalanceNote === undefined) continue;

        const patch = { openingBalance: amount };
        if (row.openingBalanceNote !== undefined) {
          patch.openingBalanceNote = String(row.openingBalanceNote).trim();
        }
        const updated = await Member.findByIdAndUpdate(row.memberId, { $set: patch }, { new: true });
        saved += 1;
        await logAudit({
          action: 'update',
          entityType: 'Member',
          entityId: updated._id,
          performedBy: req.user._id,
          before: memberBefore,
          after: snapshot(updated),
        });
      }
    }

    // The funds' own one-time totals, the same shape as the member balances above:
    // the money each fund already held before this ledger started counting.
    let savedFunds = 0;
    if (Array.isArray(funds)) {
      for (const row of funds) {
        if (!row || !mongoose.Types.ObjectId.isValid(row.typeId)) continue;
        const amount = Number(row.openingBalance);
        if (!Number.isFinite(amount)) continue;
        const typeBefore = await ContributionType.findById(row.typeId).lean();
        if (!typeBefore) continue;
        if ((typeBefore.openingBalance || 0) === amount && row.openingBalanceNote === undefined) {
          continue;
        }

        const patch = { openingBalance: amount };
        if (row.openingBalanceNote !== undefined) {
          patch.openingBalanceNote = String(row.openingBalanceNote).trim();
        }
        const updated = await ContributionType.findByIdAndUpdate(
          row.typeId,
          { $set: patch },
          { new: true }
        );
        savedFunds += 1;
        await logAudit({
          action: 'update',
          entityType: 'ContributionType',
          entityId: updated._id,
          performedBy: req.user._id,
          before: typeBefore,
          after: snapshot(updated),
        });
      }
    }

    res.json({ settings, balancesSaved: saved, fundsSaved: savedFunds });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listLedger,
  memberLedger,
  createLog,
  collectWeek,
  undoCollectWeek,
  getSetup,
  updateSetup,
};

