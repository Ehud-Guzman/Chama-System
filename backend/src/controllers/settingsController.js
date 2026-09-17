const { getOrCreateSettings } = require('../utils/settings');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { fridayOf, parseEatDate } = require('../utils/weekCycle');
const { syncLedgerTypeAmounts } = require('../utils/ledgerTypes');

// GET /api/settings (admin+)
async function getSettings(req, res, next) {
  try {
    const settings = await getOrCreateSettings();
    res.json({ settings });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/settings (admin+)
async function updateSettings(req, res, next) {
  try {
    const settings = await getOrCreateSettings();
    const before = snapshot(settings);

    const { chamaName, constitution, weeklyTrackingStartDate, weeklyAmount, chaiAmount, cycleStartWeek, weekAnchorDate } =
      req.body || {};
    if (chamaName !== undefined) {
      if (!String(chamaName).trim()) {
        return res.status(400).json({ message: 'Chama name cannot be empty' });
      }
      settings.chamaName = String(chamaName).trim();
    }
    if (constitution !== undefined) settings.constitution = String(constitution);
    // The week-cycle figures are governance numbers (constitution §7.1, §7.2).
    // The ledger screen has its own setup form for them; they are accepted here
    // too so a client holding the settings form never has to know two shapes.
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
      // Read as an EAT calendar date and normalised to its Friday, so a value
      // round-tripped from a client can never shift the anchor by a day (and
      // therefore every week number with it).
      settings.weekAnchorDate = fridayOf(parseEatDate(weekAnchorDate));
    }
    if (weeklyTrackingStartDate !== undefined) {
      if (weeklyTrackingStartDate === null || weeklyTrackingStartDate === '') {
        settings.weeklyTrackingStartDate = null;
      } else {
        const parsed = new Date(weeklyTrackingStartDate);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ message: 'Invalid weeklyTrackingStartDate' });
        }
        settings.weeklyTrackingStartDate = parsed;
      }
    }
    settings.updatedBy = req.user._id;

    await settings.save();
    // Keep the legacy per-type amounts in step with the authoritative ones.
    await syncLedgerTypeAmounts(settings);
    await logAudit({
      action: 'update',
      entityType: 'Settings',
      entityId: settings._id,
      performedBy: req.user._id,
      before,
      after: snapshot(settings),
    });
    res.json({ settings });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSettings, updateSettings };
