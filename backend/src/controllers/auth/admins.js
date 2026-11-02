// The sign-in controller, part: admins. controllers/authController.js is the index the routes use.

const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const { logAudit } = require('../../utils/auditLogger');
const { toDTO, weakPasswordMessage } = require('./common');

// GET /api/auth/admins (super_admin, admin)
async function listAdmins(req, res, next) {
  try {
    const admins = await User.find().sort({ createdAt: 1 });
    res.json({ admins: admins.map(toDTO) });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/admins (super_admin, admin) — the super admin may create any of
// the four staff roles; a plain admin may only create a 'secretary' or
// 'disciplinary' account.
//
// Two things about the role, both of which used to be wrong. A role this endpoint
// does not serve is now *named* rather than quietly turned into an admin — and a
// requested 'treasurer' used to be one of those: it fell through to 'admin', so the
// super admin's own Add-account dialog created an account with admin rights while
// its toast said "Treasurer added". The 'admin' and 'treasurer' roles are the two
// that carry authority over money, and both are the super admin's to hand out.
const CREATABLE_ROLES = ['admin', 'treasurer', 'secretary', 'disciplinary'];

const OPEN_TO_ADMINS = ['secretary', 'disciplinary'];

async function createAdmin(req, res, next) {
  try {
    const { name, email, password } = req.body || {};
    // No role at all is an admin, which is what this endpoint has always done.
    const requested = req.body?.role;
    const role = requested === undefined || requested === null || requested === '' ? 'admin' : String(requested);
    if (!name || !String(name).trim() || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (!CREATABLE_ROLES.includes(role)) {
      return res
        .status(400)
        .json({ message: 'Role must be one of admin, treasurer, secretary or disciplinary' });
    }
    if (!OPEN_TO_ADMINS.includes(role) && req.user.role !== 'super_admin') {
      return res
        .status(403)
        .json({ message: 'Only the super admin can create an admin or treasurer account' });
    }
    const weakMessage = weakPasswordMessage(password);
    if (weakMessage) {
      return res.status(400).json({ message: weakMessage });
    }
    const hashed = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      password: hashed,
      role,
    });
    await logAudit({
      action: 'create',
      entityType: 'User',
      entityId: user._id,
      performedBy: req.user._id,
      after: toDTO(user),
    });
    res.status(201).json({ user: toDTO(user) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/auth/admins/:id (super_admin, admin) — deactivate/reactivate
// only. A plain admin may only act on 'secretary'/'disciplinary' accounts.
async function updateAdmin(req, res, next) {
  try {
    const { active } = req.body || {};
    if (typeof active !== 'boolean') {
      return res.status(400).json({ message: 'active (true/false) is required' });
    }
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot deactivate your own account' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Admin not found' });
    if (target.role === 'super_admin') {
      return res.status(400).json({ message: 'The super admin account cannot be deactivated' });
    }
    if (req.user.role === 'admin' && !['secretary', 'disciplinary'].includes(target.role)) {
      return res.status(403).json({ message: 'You can only manage secretary and disciplinary accounts' });
    }
    const before = toDTO(target);
    target.active = active;
    await target.save();
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: target._id,
      performedBy: req.user._id,
      before,
      after: toDTO(target),
    });
    res.json({ user: toDTO(target) });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/admins/:id/reset-password (super_admin, admin) — there is
// no self-serve "forgot password" flow (no email delivery in this system,
// by design). A plain admin may only reset a 'secretary' account's password.
async function resetAdminPassword(req, res, next) {
  try {
    const { password } = req.body || {};
    const weakMessage = weakPasswordMessage(password);
    if (!password || weakMessage) {
      return res.status(400).json({ message: weakMessage || 'New password must be at least 8 characters' });
    }
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ message: 'Use "Change my password" for your own account' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Admin not found' });
    if (req.user.role === 'admin' && !['secretary', 'disciplinary'].includes(target.role)) {
      return res.status(403).json({ message: 'You can only manage secretary and disciplinary accounts' });
    }

    target.password = await bcrypt.hash(String(password), 10);
    // The reset ends the account's existing sessions too — that is usually the
    // whole point of resetting a password somebody else may know.
    target.passwordChangedAt = new Date();
    await target.save();
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: target._id,
      performedBy: req.user._id,
      after: { changed: 'password (reset by super admin)', for: target.email },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/admins/:id/2fa/reset (super_admin, admin) — the lost-phone door.
//
// Behind the same rule as every other admin action: a plain admin may only touch a
// secretary or disciplinary account. This clears the second factor entirely, so the
// account signs in with a password again — which is why it is loud in the audit trail and
// why whoever does it should reset that password at the same time.
async function resetAdminTwoFactor(req, res, next) {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Admin not found' });
    if (String(target._id) === String(req.user._id)) {
      return res.status(400).json({ message: 'Use "Turn off" on your own account instead' });
    }
    if (req.user.role === 'admin' && !['secretary', 'disciplinary'].includes(target.role)) {
      return res.status(403).json({ message: 'You can only manage secretary and disciplinary accounts' });
    }

    const wasEnabled = Boolean(target.twoFactor?.enabled);
    target.twoFactor.enabled = false;
    target.twoFactor.secret = '';
    target.twoFactor.pendingSecret = '';
    target.twoFactor.recoveryCodeHashes = [];
    target.twoFactor.enrolledAt = null;
    target.twoFactor.lastUsedStep = null;
    await target.save();

    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: target._id,
      performedBy: req.user._id,
      after: {
        changed: 'two-factor authentication reset by another admin (lost device)',
        wasEnabled,
        for: target.email,
      },
    });

    res.json({ ok: true, user: toDTO(target), wasEnabled });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createAdmin,
  listAdmins,
  resetAdminPassword,
  resetAdminTwoFactor,
  updateAdmin,
};
