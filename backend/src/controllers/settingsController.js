const { getOrCreateSettings } = require('../utils/settings');
const { logAudit, snapshot } = require('../utils/auditLogger');

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

    const { chamaName } = req.body || {};
    if (chamaName !== undefined) {
      if (!String(chamaName).trim()) {
        return res.status(400).json({ message: 'Chama name cannot be empty' });
      }
      settings.chamaName = String(chamaName).trim();
    }
    settings.updatedBy = req.user._id;

    await settings.save();
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
