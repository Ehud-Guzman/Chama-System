// The treasurer's ledger controller, part: weekly. controllers/ledgerController.js is the index the routes use.
//
// Raising the weekly contribution, safely.
//
// The weekly amount used to be one number, so changing it rewrote history: weeks already asked at 1,500 would
// suddenly have asked 2,000, members who had paid in full would read as short, and the group's line would jump
// for the weeks behind it. A rise is now a dated entry, "from week N the weekly amount is X": every week before N
// keeps what it asked, the line rises by X each week from N (utils/weeklyAmounts), and nothing that has closed can
// be touched. The tea is not part of this and does not change.
const { getOrCreateSettings, invalidateSettings } = require('../../utils/settings');
const { resolveConfig, currentWeekNumber, weekRange, weeklyAmountForWeek } = require('../../utils/weekCycle');
const { moneyLimitForWeek } = require('../../utils/reminderLimit');
const { syncLedgerTypeAmounts } = require('../../utils/ledgerTypes');
const { snapshot, logAudit } = require('../../utils/auditLogger');
const { readAmount, MAX_AMOUNT } = require('../../utils/money');

const money = (n) => `Ksh ${Number(n || 0).toLocaleString('en-KE')}`;

// The schedule as a screen needs it: what the cycle opened with, each rise with the week it starts and the day,
// and what is asked this week.
function describeSchedule(settings) {
  const config = resolveConfig(settings);
  const recorded = new Map((settings.weeklyAmountChanges || []).map((c) => [c.fromWeek, c]));
  return {
    currentWeek: currentWeekNumber(config),
    opening: config.weeklyBase,
    now: config.weeklyAmount,
    changes: config.weeklyChanges.map((c) => {
      const r = recorded.get(c.fromWeek);
      return {
        fromWeek: c.fromWeek,
        amount: c.amount,
        startDate: weekRange(c.fromWeek, config).startDate,
        changedAt: r ? r.changedAt : null,
        reason: r ? r.reason || '' : '',
      };
    }),
  };
}

// The line at the week a rise starts and the one after, before and after the rise: what the group is about to
// agree to, in the figure it measures every member against.
function previewRise(settings, fromWeek, amount) {
  const config = resolveConfig(settings);
  const plain = typeof settings.toObject === 'function' ? settings.toObject() : { ...settings };
  const kept = (plain.weeklyAmountChanges || []).filter((c) => c.fromWeek !== fromWeek);
  const after = { ...plain, weeklyAmountChanges: [...kept, { fromWeek, amount }] };
  const configAfter = resolveConfig(after);
  const lineAt = (s, c, w) => moneyLimitForWeek(s, c, w);
  return {
    fromWeek,
    startDate: weekRange(fromWeek, config).startDate,
    amountBefore: weeklyAmountForWeek({ ...config, weeklyChanges: config.weeklyChanges.filter((c) => c.fromWeek !== fromWeek) }, fromWeek - 1),
    amountAfter: amount,
    line: {
      atStartBefore: lineAt(plain, config, fromWeek),
      atStartAfter: lineAt(after, configAfter, fromWeek),
      nextWeekBefore: lineAt(plain, config, fromWeek + 1),
      nextWeekAfter: lineAt(after, configAfter, fromWeek + 1),
    },
  };
}

// POST /api/ledger/weekly-amount  { fromWeek, amount, reason?, dryRun? }
async function setWeeklyAmount(req, res, next) {
  try {
    const settings = await getOrCreateSettings();
    const config = resolveConfig(settings);
    const current = currentWeekNumber(config);
    const { fromWeek: rawWeek, amount: rawAmount, reason, dryRun } = req.body || {};

    // Everything is read and checked before anything is written, and `settings` is the process-wide cached
    // document, so nothing is assigned until all of it has passed.
    const fromWeek = Number(rawWeek);
    if (!Number.isInteger(fromWeek) || fromWeek < 1) {
      return res.status(400).json({ message: 'Say which week the new amount starts from, as a week number' });
    }
    if (fromWeek < current) {
      return res.status(400).json({
        message:
          `Week ${fromWeek} has already started. A new weekly amount can start from the current week (${current}) or later: ` +
          'weeks that have closed keep what they asked.',
      });
    }
    const read = readAmount(rawAmount);
    if (read.skip || read.invalid || read.outOfRange || !(read.amount > 0)) {
      return res.status(400).json({ message: `The new weekly amount must be a number above zero and below ${money(MAX_AMOUNT)}` });
    }
    const amount = read.amount;
    if (amount < config.chaiAmount) {
      return res.status(400).json({ message: 'The weekly amount cannot be less than the tea, which is taken out of it' });
    }
    const existing = (settings.weeklyAmountChanges || []).find((c) => c.fromWeek === fromWeek);
    const before = weeklyAmountForWeek(
      { ...config, weeklyChanges: config.weeklyChanges.filter((c) => c.fromWeek !== fromWeek) },
      fromWeek - 1
    );
    if (amount === before) {
      return res.status(400).json({
        message:
          `The weekly amount is already ${money(before)} going into week ${fromWeek}, so this changes nothing` +
          (existing ? '. To undo the change that starts that week, cancel it instead.' : ''),
      });
    }
    const reasonText = String(reason || '').trim().slice(0, 300);

    const preview = previewRise(settings, fromWeek, amount);
    if (dryRun) return res.json({ preview, schedule: describeSchedule(settings) });

    const snapshotBefore = snapshot(settings);
    const entry = { fromWeek, amount, changedBy: req.user._id, changedAt: new Date(), reason: reasonText };
    const list = (settings.weeklyAmountChanges || []).filter((c) => c.fromWeek !== fromWeek);
    list.push(entry);
    list.sort((a, b) => a.fromWeek - b.fromWeek);
    settings.weeklyAmountChanges = list;
    settings.updatedBy = req.user._id;
    await settings.save();
    invalidateSettings();
    await syncLedgerTypeAmounts(settings);

    await logAudit({
      action: 'update',
      entityType: 'Settings',
      entityId: settings._id,
      performedBy: req.user._id,
      before: snapshotBefore,
      after: { ...snapshot(settings), weeklyAmountChange: { fromWeek, amount, replaced: Boolean(existing), reason: reasonText } },
    });

    res.status(existing ? 200 : 201).json({ preview, schedule: describeSchedule(settings) });
  } catch (err) {
    // The cached settings document may have been changed in memory before the save failed.
    invalidateSettings();
    next(err);
  }
}

// DELETE /api/ledger/weekly-amount/:fromWeek — take back a change that has not started, or whose week is still
// running. A change whose week has closed has been asked of every member and stays.
async function cancelWeeklyAmount(req, res, next) {
  try {
    const settings = await getOrCreateSettings();
    const config = resolveConfig(settings);
    const current = currentWeekNumber(config);
    const fromWeek = Number(req.params.fromWeek);
    const existing = (settings.weeklyAmountChanges || []).find((c) => c.fromWeek === fromWeek);
    if (!existing) return res.status(404).json({ message: `No change to the weekly amount starts at week ${fromWeek}` });
    if (fromWeek < current) {
      return res.status(400).json({
        message: `That change started at week ${fromWeek} and has already been asked of every member, so it cannot be taken back.`,
      });
    }
    const snapshotBefore = snapshot(settings);
    settings.weeklyAmountChanges = (settings.weeklyAmountChanges || []).filter((c) => c.fromWeek !== fromWeek);
    settings.updatedBy = req.user._id;
    await settings.save();
    invalidateSettings();
    await syncLedgerTypeAmounts(settings);
    await logAudit({
      action: 'update',
      entityType: 'Settings',
      entityId: settings._id,
      performedBy: req.user._id,
      before: snapshotBefore,
      after: { ...snapshot(settings), weeklyAmountChangeCancelled: { fromWeek, amount: existing.amount } },
    });
    res.json({ schedule: describeSchedule(settings) });
  } catch (err) {
    invalidateSettings();
    next(err);
  }
}

module.exports = {
  describeSchedule,
  previewRise,
  setWeeklyAmount,
  cancelWeeklyAmount,
};
