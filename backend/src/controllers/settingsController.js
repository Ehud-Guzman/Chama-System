const { getOrCreateSettings, invalidateSettings } = require('../utils/settings');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { fridayOf, parseEatDate } = require('../utils/weekCycle');
const { syncLedgerTypeAmounts } = require('../utils/ledgerTypes');
const { destroyImage } = require('../utils/cloudinary');

// The vision and mission statements travel in the public overview, so every
// visitor's page load carries them. That is why they are capped while the
// constitution field — which only ever travels to an admin who asked for
// Settings — is not.
const STATEMENT_MAX = 600;

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

    const {
      chamaName,
      constitution,
      vision,
      mission,
      logoUrl,
      logoPublicId,
      weeklyTrackingStartDate,
      weeklyAmount,
      chaiAmount,
      cycleStartWeek,
      weekAnchorDate,
    } = req.body || {};
    if (chamaName !== undefined) {
      if (!String(chamaName).trim()) {
        return res.status(400).json({ message: 'Chama name cannot be empty' });
      }
      settings.chamaName = String(chamaName).trim();
    }
    if (constitution !== undefined) settings.constitution = String(constitution);

    // The group's vision and mission, as the members' page prints them. Emptying
    // either box is a real choice rather than a way to lose the statement: a blank
    // one falls back to the wording in the published constitution (Chapter 2), so
    // the page always has something to show.
    if (vision !== undefined) {
      const text = String(vision).trim();
      if (text.length > STATEMENT_MAX) {
        return res.status(400).json({ message: `Keep the vision to ${STATEMENT_MAX} characters or fewer` });
      }
      settings.vision = text;
    }
    if (mission !== undefined) {
      const text = String(mission).trim();
      if (text.length > STATEMENT_MAX) {
        return res.status(400).json({ message: `Keep the mission to ${STATEMENT_MAX} characters or fewer` });
      }
      settings.mission = text;
    }

    // The logo. URL and publicId travel as a pair — storing one without the other
    // would mean holding an image nothing can ever delete again — so a request
    // carrying only one of them is refused rather than half-applied. The settings
    // form always sends both, both-empty included, and that is how a logo is
    // removed.
    if ((logoUrl !== undefined) !== (logoPublicId !== undefined)) {
      return res
        .status(400)
        .json({ message: 'The logo image and its public id have to be saved together' });
    }

    // A replaced or cleared logo takes its Cloudinary asset with it — the same
    // rule a member photo follows. The old publicId is only remembered here and
    // destroyed after a successful save, so a failed save can never leave the
    // group with neither its old logo nor the new one.
    const replacedLogoId =
      logoPublicId !== undefined &&
      settings.logoPublicId &&
      settings.logoPublicId !== String(logoPublicId).trim()
        ? settings.logoPublicId
        : null;

    if (logoPublicId !== undefined) {
      settings.logoUrl = String(logoUrl || '').trim();
      settings.logoPublicId = String(logoPublicId || '').trim();
    }
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
    if (replacedLogoId) await destroyImage(replacedLogoId);
    invalidateSettings();
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
