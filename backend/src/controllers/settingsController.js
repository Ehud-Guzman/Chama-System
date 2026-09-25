const { getOrCreateSettings, invalidateSettings } = require('../utils/settings');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { syncLedgerTypeAmounts } = require('../utils/ledgerTypes');
const { destroyImage } = require('../utils/cloudinary');
const { normaliseMaxPerWeek, MAX_PER_WEEK_CEILING } = require('../utils/reminderLog');

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
      autoSettleFines,
      twoFactorAuthEnabled,
      reminderMaxPerWeek,
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
    // The week-cycle figures — the weekly amount, the tea, the start week and the
    // anchor date — are deliberately *not* settable here.
    //
    // They are governance numbers (constitution §7.1, §7.2) and they are guarded
    // where they belong: PATCH /api/ledger/setup reads the whole sheet before
    // writing any of it, refuses a save that would cut the members' total by a
    // quarter or more until the caller confirms, and audits what it wrote. Accepting
    // the same fields on this endpoint meant one request could renumber every week
    // already on the ledger, silently, with none of that protection — and the
    // settings form does not send them anyway.
    const cycleFields = { weeklyAmount, chaiAmount, cycleStartWeek, weekAnchorDate };
    const posted = Object.entries(cycleFields).find(
      ([, value]) => value !== undefined && value !== null
    );
    if (posted) {
      return res.status(400).json({
        message:
          'Weekly amount, tea, start week and the week anchor are set on Finance → Setup, where a change that would move every balance is confirmed before it is saved.',
        field: posted[0],
      });
    }
    // Whether a payment pays down pending fines before it counts as contribution.
    // Off by default, and deliberately *not* part of the settings form: it changes
    // what the books say about money, so it is set deliberately (super admin, one
    // field), not by whatever a page happens to send.
    if (autoSettleFines !== undefined) {
      if (req.user.role !== 'super_admin') {
        return res
          .status(403)
          .json({ message: 'Only the super admin can change how payments are applied to fines.' });
      }
      if (typeof autoSettleFines !== 'boolean') {
        return res.status(400).json({ message: 'autoSettleFines must be true or false' });
      }
      settings.autoSettleFines = autoSettleFines;
    }
    // Two-factor authentication, as a group decision rather than a personal one.
    //
    // Super admin only, like autoSettleFines above and for the same kind of reason: it changes what
    // everybody else has to do to sign in. Off by default, so a deploy carrying this code changes
    // nothing until somebody with the authority decides it should.
    if (twoFactorAuthEnabled !== undefined) {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({
          message: 'Only the super admin can switch two-factor authentication on or off for the group.',
        });
      }
      if (typeof twoFactorAuthEnabled !== 'boolean') {
        return res.status(400).json({ message: 'twoFactorAuthEnabled must be true or false' });
      }
      settings.twoFactorAuthEnabled = twoFactorAuthEnabled;
    }
    // How many reminder emails one member may be sent in a contribution week; 0 is no limit.
    // Any admin can set this one: it is how the group talks to its members, not a rule about
    // money, and the treasurer who presses send is the person who feels a wrong number first.
    //
    // Out-of-range is refused rather than quietly clamped. A limit the office did not choose,
    // applied to a member the office cannot see being skipped, is the kind of silent correction
    // that ends with somebody insisting "it said one a week" about a setting that says nine.
    if (reminderMaxPerWeek !== undefined) {
      const value = Number(reminderMaxPerWeek);
      if (!Number.isInteger(value) || value < 0 || value > MAX_PER_WEEK_CEILING) {
        return res.status(400).json({
          message:
            `Reminders per member per week must be a whole number from 0 to ${MAX_PER_WEEK_CEILING} `
            + '(0 means no limit).',
          field: 'reminderMaxPerWeek',
        });
      }
      settings.reminderMaxPerWeek = normaliseMaxPerWeek(value);
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
