const jwt = require('jsonwebtoken');
const { getOrCreateSettings } = require('../utils/settings');
const { SAFE_METHODS } = require('./auth');

// Maintenance mode: the books are read-only for everyone except the super admin.
//
// For the hour a restore or a correction is being done, when a treasurer logging a payment into
// the middle of it would be lost or would corrupt it. Reads still work, so the office can look
// things up; only writes are refused, and the refusal says why in the super admin's own words.
//
// Sign-in, the second-factor step and the password-reset pair are exempt — locking everyone out
// of signing in would also lock out the one person who has to switch it off. A super admin's
// session is recognised by its signed token alone, so no database read is added for them.
const EXEMPT = new Set([
  '/api/auth/login',
  '/api/auth/2fa/verify',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
]);

function isSuperAdminToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return payload.role === 'super_admin' && !payload.viewAs && (!payload.scope || payload.scope === 'session');
  } catch {
    return false;
  }
}

async function maintenanceGuard(req, res, next) {
  try {
    if (SAFE_METHODS.has(req.method)) return next();
    const path = String(req.originalUrl || '').split('?')[0];
    if (EXEMPT.has(path)) return next();

    const settings = await getOrCreateSettings();
    if (!settings?.maintenanceMode) return next();
    if (isSuperAdminToken(req)) return next();

    return res.status(503).json({
      message: settings.maintenanceMessage
        ? `The system is in maintenance: ${settings.maintenanceMessage}`
        : 'The system is in maintenance for a short while. You can look things up, but not change them yet.',
      code: 'maintenance',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { maintenanceGuard };
