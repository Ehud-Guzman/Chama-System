const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { logAudit } = require('../utils/auditLogger');

function toDTO(user) {
  return { id: user._id, name: user.name, email: user.email, role: user.role, active: user.active };
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
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
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

// GET /api/auth/admins (super_admin)
async function listAdmins(req, res, next) {
  try {
    const admins = await User.find().sort({ createdAt: 1 });
    res.json({ admins: admins.map(toDTO) });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/admins (super_admin) — always creates role 'admin'
async function createAdmin(req, res, next) {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !String(name).trim() || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    const hashed = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      password: hashed,
      role: 'admin',
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

// PATCH /api/auth/admins/:id (super_admin) — deactivate/reactivate only
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

// POST /api/auth/admins/:id/reset-password (super_admin) — there is no
// self-serve "forgot password" flow (no email delivery in this system, by
// design), so a locked-out admin needs the super admin to set a new one.
async function resetAdminPassword(req, res, next) {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ message: 'Use "Change my password" for your own account' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Admin not found' });

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
