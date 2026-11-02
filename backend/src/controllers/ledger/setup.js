// The treasurer's ledger controller, part: setup. controllers/ledgerController.js is the index the routes use.

const Member = require('../../models/Member');
const ContributionType = require('../../models/ContributionType');
const Contribution = require('../../models/Contribution');
const Expense = require('../../models/Expense');
const mongoose = require('mongoose');
const { getOrCreateSettings, invalidateSettings } = require('../../utils/settings');
const { resolveConfig, toEatDateString, currentWeekNumber, weekRange, fridayOf, parseEatDate } = require('../../utils/weekCycle');
const { seedGroupFunds, bucketForType, syncLedgerTypeAmounts } = require('../../utils/ledgerTypes');
const { suggestedOpeningBalances } = require('../../utils/suggestedBalances');
const { teaMemberWeeks } = require('../../utils/teaCharges');
const { snapshot, logAudit } = require('../../utils/auditLogger');
const { readAmount, MAX_AMOUNT } = require('../../utils/money');

// What a save-all is about to do to the members' figures, worked out before a
// single write. One screen holds 32 balances and one button overwrites them, so
// a sheet that was filled in wrongly (every box reading the weekly 1400) can
// take a whole cycle of verified paper-ledger figures out in one click, silently.
// This is the shape the frontend puts in front of the treasurer when the drop is
// big enough to be worth a second look.
async function summariseBalanceChange(rows) {
  if (rows.length === 0) {
    return { changed: 0, before: 0, after: 0, requiresConfirmation: false };
  }
  const current = await Member.find({ _id: { $in: rows.map((r) => r.memberId) } })
    .select('openingBalance')
    .lean();
  const nowById = new Map(current.map((m) => [String(m._id), Number(m.openingBalance) || 0]));

  let before = 0;
  let after = 0;
  let changed = 0;
  for (const row of rows) {
    const now = nowById.get(String(row.memberId)) || 0;
    before += now;
    after += row.amount;
    if (now !== row.amount) changed += 1;
  }
  // Only a *drop* of a quarter or more asks for confirmation: setting the sheet
  // up for the first time is an increase, and correcting one member is never a
  // wipe. A save that leaves the total as it was is not worth a dialog either.
  const requiresConfirmation = changed > 0 && before > 0 && after < before * 0.75;
  return { changed, before, after, requiresConfirmation };
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
    // The funds are seeded, not typed: this table can only be filled in if every
    // fund the group keeps is already on it.
    await seedGroupFunds();

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
    // works it out: the automatic 100 a member for every *closed* scored week.
    const automaticTea = config.chaiAmount * (await teaMemberWeeks(config, { activeMembers: activeMemberCount }));

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
    const { cycleStartWeek, weeklyAmount, chaiAmount, weekAnchorDate, balances, funds, confirm } =
      req.body || {};

    // Everything is read before anything is written, so a sheet with one unreadable
    // figure in it saves nothing at all rather than half of itself. Blank boxes say
    // "leave this one alone" (see readAmount).
    const rejected = [];
    const outOfRange = [];
    const memberRows = [];
    if (Array.isArray(balances)) {
      for (const row of balances) {
        if (!row || !mongoose.Types.ObjectId.isValid(row.memberId)) continue;
        const read = readAmount(row.openingBalance);
        if (read.invalid) {
          rejected.push(`member ${row.memberId}: "${row.openingBalance}"`);
          continue;
        }
        if (read.outOfRange) {
          outOfRange.push(`member ${row.memberId}: "${row.openingBalance}"`);
          continue;
        }
        if (read.skip) continue;
        memberRows.push({ memberId: row.memberId, amount: read.amount, note: row.openingBalanceNote });
      }
    }

    const fundRows = [];
    if (Array.isArray(funds)) {
      for (const row of funds) {
        if (!row || !mongoose.Types.ObjectId.isValid(row.typeId)) continue;
        const read = readAmount(row.openingBalance);
        if (read.invalid) {
          rejected.push(`fund ${row.typeId}: "${row.openingBalance}"`);
          continue;
        }
        if (read.outOfRange) {
          outOfRange.push(`fund ${row.typeId}: "${row.openingBalance}"`);
          continue;
        }
        if (read.skip) continue;
        fundRows.push({ typeId: row.typeId, amount: read.amount, note: row.openingBalanceNote });
      }
    }

    if (rejected.length > 0) {
      return res.status(400).json({
        message: `These figures are not numbers: ${rejected.join(', ')}. Use digits only, e.g. 1400 or 1,400.`,
      });
    }
    // The model's own min/max only run on save(), and these figures are written with an update, so
    // the range is held here: a balance below nothing or past a billion is a typo, not a figure.
    if (outOfRange.length > 0) {
      return res.status(400).json({
        message:
          `These figures are out of range (0 to ${MAX_AMOUNT.toLocaleString('en-KE')}): ` +
          `${outOfRange.join(', ')}. Nothing was saved.`,
      });
    }

    // The cycle figures are all read and checked before ANY of them is applied. `settings` is the
    // process-wide cached document, so assigning one field and then refusing the next would leave
    // the refused request's value live for every other request until the cache expires.
    const weekly = readAmount(weeklyAmount);
    if (weekly.invalid || weekly.outOfRange) {
      return res.status(400).json({ message: 'The weekly amount must be a number above zero' });
    }
    if (weekly.amount !== undefined && weekly.amount <= 0) {
      return res.status(400).json({ message: 'Weekly amount must be greater than zero' });
    }
    const chai = readAmount(chaiAmount);
    if (chai.invalid || chai.outOfRange) {
      return res.status(400).json({ message: 'The tea amount must be a number, zero or more' });
    }
    // Tea is cut from every member's contribution, so it cannot be more than the contribution.
    if (chai.amount !== undefined && chai.amount > (weekly.amount ?? settings.weeklyAmount)) {
      return res.status(400).json({ message: 'The tea amount cannot be more than the weekly amount' });
    }
    let startWeek;
    if (cycleStartWeek !== undefined) {
      startWeek = parseInt(cycleStartWeek, 10);
      if (!Number.isInteger(startWeek) || startWeek < 1) {
        return res.status(400).json({ message: 'Start week must be a whole number of at least 1' });
      }
    }
    const hasAnchor = weekAnchorDate !== undefined && weekAnchorDate !== null && weekAnchorDate !== '';
    const anchor = hasAnchor ? fridayOf(parseEatDate(weekAnchorDate)) : null;
    if (hasAnchor && Number.isNaN(anchor.getTime())) {
      return res.status(400).json({ message: 'The week anchor is not a date' });
    }

    // The whole sheet is aimed at the whole group, so a wrong sheet is a wrong
    // group: this is the one place in the system where a single click can take
    // 32 verified balances out. A save that would cut the members' total by a
    // quarter or more is therefore refused once, with both totals and the number
    // of members it would move, until the caller says it means it (`confirm`).
    // Nothing is written on this path, so the box the treasurer mistyped is still
    // there to be fixed.
    const summary = await summariseBalanceChange(memberRows);
    if (summary.requiresConfirmation && confirm !== true) {
      return res.status(409).json({
        message:
          `This would change ${summary.changed} member balance(s) and take the total from ${summary.before} to ` +
          `${summary.after}. If that is what the paper ledger says, confirm and it will be saved.`,
        confirmation: summary,
      });
    }

    // Everything above passed, so the cycle figures are applied together. The anchor was parsed as
    // an EAT calendar date and normalised to its Friday — it is a week boundary, and a mid-week
    // value would renumber every week already on the ledger.
    if (weekly.amount !== undefined) settings.weeklyAmount = weekly.amount;
    if (chai.amount !== undefined) settings.chaiAmount = chai.amount;
    if (startWeek !== undefined) settings.cycleStartWeek = startWeek;
    if (anchor) settings.weekAnchorDate = anchor;
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
    for (const row of memberRows) {
      const amount = row.amount;
      const memberBefore = await Member.findById(row.memberId).lean();
      if (!memberBefore) continue;
      if ((memberBefore.openingBalance || 0) === amount && row.note === undefined) continue;

      const patch = { openingBalance: amount };
      if (row.note !== undefined) patch.openingBalanceNote = String(row.note).trim();
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

    // The funds' own one-time totals, the same shape as the member balances above:
    // the money each fund already held before this ledger started counting.
    let savedFunds = 0;
    for (const row of fundRows) {
      const amount = row.amount;
      const typeBefore = await ContributionType.findById(row.typeId).lean();
      if (!typeBefore) continue;
      if ((typeBefore.openingBalance || 0) === amount && row.note === undefined) continue;

      const patch = { openingBalance: amount };
      if (row.note !== undefined) patch.openingBalanceNote = String(row.note).trim();
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

    res.json({ settings, balancesSaved: saved, fundsSaved: savedFunds, summary });
  } catch (err) {
    // The cached settings document may have been changed in memory before the save failed; drop it
    // so the next request reads what is really stored.
    invalidateSettings();
    next(err);
  }
}

module.exports = {
  getSetup,
  updateSetup,
};
