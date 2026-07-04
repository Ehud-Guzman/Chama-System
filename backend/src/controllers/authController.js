const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

function toDTO(user) {
  return { id: user._id, name: user.name, email: user.email, role: user.role, active: user.active };
}

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

// POST /api/auth/login (public)
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
    target.active = active;
    await target.save();
    res.json({ user: toDTO(target) });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, me, listAdmins, createAdmin, updateAdmin };
