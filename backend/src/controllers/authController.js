const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { logAudit } = require('../utils/auditLogger');

function toDTO(user) {
  return { id: user._id, name: user.name, email: user.email, role: user.role, active: user.active };
}

// At least 8 characters with a mix of letters and numbers — stops trivial
// all-digit or all-letter passwords without demanding a full complexity policy.
function weakPasswordMessage(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must include both letters and numbers';
  }
  return null;
}

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

// POST /api/auth/login (public, rate-limited)
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+password');
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (!user.active) {
      return res.status(401).json({ message: 'This account has been deactivated' });
    }
    res.json({ token: signToken(user), user: toDTO(user) });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/me (admin+)
async function me(req, res) {
  res.json({ user: toDTO(req.user) });
}

// PATCH /api/auth/me/password (admin+) — self-service password change
async function changeOwnPassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    const weakMessage = weakPasswordMessage(newPassword);
    if (weakMessage) {
      return res.status(400).json({ message: weakMessage });
    }
    const user = await User.findById(req.user._id).select('+password');
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    user.password = await bcrypt.hash(String(newPassword), 10);
    await user.save();
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: user._id,
      performedBy: req.user._id,
      after: { changed: 'password' },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/admins (super_admin, admin)
async function listAdmins(req, res, next) {
  try {
    const admins = await User.find().sort({ createdAt: 1 });
    res.json({ admins: admins.map(toDTO) });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/admins (super_admin, admin) — super_admin may create an
// 'admin' or 'secretary'; a plain admin may only create a 'secretary'.
async function createAdmin(req, res, next) {
  try {
    const { name, email, password } = req.body || {};
    const role = req.body?.role === 'secretary' ? 'secretary' : 'admin';
    if (!name || !String(name).trim() || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (role === 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Only the super admin can create an admin account' });
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
// only. A plain admin may only act on 'secretary' accounts.
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
    if (req.user.role === 'admin' && target.role !== 'secretary') {
      return res.status(403).json({ message: 'You can only manage secretary accounts' });
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
    if (req.user.role === 'admin' && target.role !== 'secretary') {
      return res.status(403).json({ message: 'You can only manage secretary accounts' });
    }

    target.password = await bcrypt.hash(String(password), 10);
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

module.exports = {
  login,
  me,
  changeOwnPassword,
  listAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
};
