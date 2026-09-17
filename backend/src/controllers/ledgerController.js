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
    ContributionType.find().select('name isWeekly isGroupFund tracksExpenses active').lean(),
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
    const [activeMembers, expenses] = await Promise.all([
      Member.countDocuments({ active: true }),
      fundTypeIds.length === 0
        ? Promise.resolve([])
        : Expense.find({ typeId: { $in: fundTypeIds }, deleted: false })
            .sort({ date: -1, createdAt: -1 })
            .limit(25)
            .populate('typeId', 'name')
            .populate('loggedBy', 'name')
            .lean(),
    ]);
    // The Tea Fund's income is automatic — 100 per member per week of the cycle —
    // so it is derived here rather than summed from contribution rows.
    const teaIncome = config.chaiAmount * ledger.weeksElapsed * activeMembers;
    const balances = await Promise.all(
      fundTypes.map((t) => fundBalance(t._id, { extraIncome: bucketForType(t) === 'chai' ? teaIncome : 0 }))
    );

    res.json({
      member: summariseMember(member, ledger),
      ledger,
      week: { currentWeek: ledger.currentWeek, ...weekRange(ledger.currentWeek, config) },
      // Weeks 1..(cycleStartWeek-1) — the group's whole history, so the week list
      // reads back to week one with every Thursday in place, even though only the
      // live weeks carry an expectation.
      history: cycleHistory(config),
      // Each log carries the week it falls in so the list can be read the same
      // way the paper ledger was — by week, not just by date.
      logs: contributions.map((c) => ({ ...c, week: cycleWeekNumber(c.date, config) })),
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

// Which bucket a log kind writes to. Tea has no kind: it is deducted
// automatically and never logged.
function kindsToType(kind, types) {
  if (kind === 'weekly') return types.weekly;
  return null;
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

    const [members, held] = await Promise.all([
      Member.find().sort({ name: 1 }).lean(),
      suggestedOpeningBalances(),
    ]);

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
    const { cycleStartWeek, weeklyAmount, chaiAmount, weekAnchorDate, balances } = req.body || {};

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

    res.json({ settings, balancesSaved: saved });
  } catch (err) {
    next(err);
  }
}

module.exports = { listLedger, memberLedger, createLog, getSetup, updateSetup };

