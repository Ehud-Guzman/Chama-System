const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { logAudit } = require('../utils/auditLogger');
const { checkPassword, refuseUnlessConfirmed } = require('../utils/reauth');

// What only the super admin can do to an account: see how it is being used, end its sessions,
// freeze it, change its role, and look at the app through its eyes.
//
// The admin's own account tools (create, deactivate, reset a password) stay where they are
// (controllers/authController); these are the ones above them. Every one writes the audit trail,
// and every one that cannot be undone with a tap asks for the password again.
//
// Each entry carries the account's role on both sides. That is not decoration: the audit trail
// keeps entries about the accounts that outrank an admin out of an admin's sight
// (utils/auditVisibility reads `role` on either side), and an entry that named no role would be
// readable by the very people it is about. Equal on both sides, it is also not a "role changed"
// flag (utils/auditFlags compares the two).

const ONLINE_WITHIN_MS = 10 * 60 * 1000;
const ROLES = ['super_admin', 'admin', 'treasurer', 'secretary', 'disciplinary'];
const PREVIEW_MINUTES = 30;

function activityDTO(user, now = Date.now()) {
  const lastActive = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : null;
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    frozen: Boolean(user.frozenAt),
    frozenAt: user.frozenAt || null,
    frozenReason: user.frozenReason || '',
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    lastLoginIp: user.lastLoginIp || '',
    lastActiveAt: user.lastActiveAt || null,
    online: lastActive !== null && now - lastActive < ONLINE_WITHIN_MS,
    failedLoginCount: user.failedLoginCount || 0,
    lastFailedLoginAt: user.lastFailedLoginAt || null,
    twoFactorEnabled: Boolean(user.twoFactor?.enabled),
    signedOutAt: user.sessionsRevokedAt || null,
  };
}

// GET /api/superadmin/accounts
async function listAccounts(req, res, next) {
  try {
    const users = await User.find().sort({ createdAt: 1 });
    const now = Date.now();
    res.json({ accounts: users.map((user) => activityDTO(user, now)), roles: ROLES });
  } catch (err) {
    next(err);
  }
}

// POST /api/superadmin/accounts/:id/sign-out — end every session the account has.
async function signOutAccount(req, res, next) {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Account not found' });
    if (String(target._id) === String(req.user._id)) {
      return res.status(400).json({ message: 'To end your own session, use Sign out.' });
    }
    target.sessionsRevokedAt = new Date();
    await target.save();
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: target._id,
      performedBy: req.user._id,
      before: { role: target.role },
      after: { role: target.role, changed: 'signed out everywhere by the super admin', for: target.email },
    });
    res.json({ ok: true, account: activityDTO(target) });
  } catch (err) {
    next(err);
  }
}

// POST /api/superadmin/accounts/sign-out-all — everyone but the caller. For "I think somebody has
// a copy of a password" and for after a restore.
async function signOutEveryone(req, res, next) {
  try {
    const result = await User.updateMany(
      { _id: { $ne: req.user._id } },
      { $set: { sessionsRevokedAt: new Date() } }
    );
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: req.user._id,
      performedBy: req.user._id,
      before: { role: req.user.role },
      after: { role: req.user.role, changed: 'every other account signed out by the super admin', accounts: result.modifiedCount },
    });
    res.json({ ok: true, accounts: result.modifiedCount });
  } catch (err) {
    next(err);
  }
}

// POST /api/superadmin/accounts/:id/freeze { reason }
async function freezeAccount(req, res, next) {
  try {
    const reason = String(req.body?.reason || '').trim().slice(0, 200);
    if (reason.length < 3) {
      return res.status(400).json({ message: 'Say why in a few words — the person will be shown it.' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Account not found' });
    if (String(target._id) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot freeze your own account.' });
    }
    // The caller is a super admin and is not the target (checked above), so freezing or demoting
    // another super admin can never leave the system without one.
    target.frozenAt = new Date();
    target.frozenReason = reason;
    target.sessionsRevokedAt = new Date();
    await target.save();
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: target._id,
      performedBy: req.user._id,
      before: { role: target.role, frozen: false },
      after: { role: target.role, changed: 'account frozen', frozen: true, reason, for: target.email },
    });
    res.json({ ok: true, account: activityDTO(target) });
  } catch (err) {
    next(err);
  }
}

// POST /api/superadmin/accounts/:id/unfreeze
async function unfreezeAccount(req, res, next) {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Account not found' });
    target.frozenAt = null;
    target.frozenReason = '';
    // A clean start: the wrong-password count that may have led to the freeze goes with it.
    target.failedLoginCount = 0;
    await target.save();
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: target._id,
      performedBy: req.user._id,
      before: { role: target.role, frozen: true },
      after: { role: target.role, changed: 'account unfrozen', frozen: false, for: target.email },
    });
    res.json({ ok: true, account: activityDTO(target) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/superadmin/accounts/:id/role { role, password }
//
// The role was fixed at creation until now: a treasurer who became the chairman meant deactivating
// the account and making a new one, with a new email and a lost history. Changing it ends the
// account's sessions, so no token minted for the old role outlives the change.
async function changeRole(req, res, next) {
  try {
    const role = String(req.body?.role || '');
    if (!ROLES.includes(role)) {
      return res.status(400).json({ message: `Role must be one of ${ROLES.join(', ')}` });
    }
    if (refuseUnlessConfirmed(await checkPassword(req), res)) return;

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'Account not found' });
    if (String(target._id) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot change your own role.' });
    }
    if (target.role === role) {
      return res.status(400).json({ message: 'That is already their role.' });
    }

    const before = { role: target.role };
    target.role = role;
    target.sessionsRevokedAt = new Date();
    await target.save();
    await logAudit({
      action: 'update',
      entityType: 'User',
      entityId: target._id,
      performedBy: req.user._id,
      before,
      after: { role, changed: `role changed from ${before.role} to ${role}`, for: target.email },
    });
    res.json({ ok: true, account: activityDTO(target) });
  } catch (err) {
    next(err);
  }
}

// POST /api/superadmin/preview { role }
//
// A read-only session that shows the app as another role sees it (middleware/auth: `viewAs`).
// The best answer to "what can the treasurer see?" is to look, and to "why can't the secretary
// find the thing?" is to look as the secretary. Writes are refused for the whole preview, so a
// stray tap can never change anything while wearing someone else's permissions.
async function startPreview(req, res, next) {
  try {
    // (A preview session carries the borrowed role, so requireRole('super_admin') already refuses
    // it before this runs: nobody can start a preview from inside one.)
    const role = String(req.body?.role || '');
    if (!ROLES.includes(role) || role === 'super_admin') {
      return res.status(400).json({ message: 'Choose admin, treasurer, secretary or disciplinary.' });
    }
    const token = jwt.sign(
      { id: req.user._id, role: 'super_admin', scope: 'session', viewAs: role },
      process.env.JWT_SECRET,
      { expiresIn: `${PREVIEW_MINUTES}m` }
    );
    await logAudit({
      action: 'create',
      entityType: 'System',
      entityId: req.user._id,
      performedBy: req.user._id,
      after: { action: 'preview-started', role, minutes: PREVIEW_MINUTES },
    });
    res.json({ token, role, minutes: PREVIEW_MINUTES });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  ROLES,
  activityDTO,
  listAccounts,
  signOutAccount,
  signOutEveryone,
  freezeAccount,
  unfreezeAccount,
  changeRole,
  startPreview,
};
