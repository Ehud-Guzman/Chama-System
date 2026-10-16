const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Only one algorithm is ever accepted. Without this, `verify` will happily check a
// token against whatever the header claims — the classic way a deployment ends up
// trusting an HS256 token signed with a public key.
const ALGORITHMS = ['HS256'];

// "Last active" is written at most this often per account. It is a number for the super admin
// to read, not a heartbeat: one write a minute is enough to tell "here now" from "gone for the
// day", and a write on every request would turn every page load into two database calls.
const ACTIVITY_WRITE_EVERY_MS = 60 * 1000;
const lastActivityWrite = new Map();

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function noteActivity(user) {
  const key = String(user._id);
  const now = Date.now();
  if (now - (lastActivityWrite.get(key) || 0) < ACTIVITY_WRITE_EVERY_MS) return;
  // Bounded: an account that has not been seen for a while is simply written again next time, so
  // the map never needs to remember more than the recently active few.
  if (lastActivityWrite.size > 500) lastActivityWrite.clear();
  lastActivityWrite.set(key, now);
  // Fire and forget: a failed bookkeeping write must never fail the request it rode in on.
  User.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date(now) } }).catch(() => {});
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ALGORITHMS });

    // A token that only proves "the password was right" is not a session. The 2FA
    // challenge is a JWT too, because it is the same signed thing with a shorter life
    // and a smaller claim — so it has to be told apart from a real one here, or the
    // second factor would be optional for anyone who reads the challenge out of the
    // sign-in response.
    //
    // Tokens issued before the 2FA step existed carry no scope at all, and are treated
    // as sessions: refusing them would sign every admin out on deploy for no gain.
    if (payload.scope && payload.scope !== 'session') {
      return res.status(401).json({ message: 'Your sign-in is not finished. Please start again.' });
    }

    const user = await User.findById(payload.id);
    if (!user || !user.active) {
      return res.status(401).json({ message: 'Account not found or deactivated' });
    }

    // A frozen account is switched off, with the reason given. Checked on every request, so a
    // freeze takes hold immediately rather than when the token happens to expire.
    if (user.frozenAt) {
      return res.status(401).json({
        message: user.frozenReason
          ? `This account is frozen: ${user.frozenReason}`
          : 'This account has been frozen. Ask the super admin.',
      });
    }

    // A password change ends every session older than it. Without this a token that
    // leaked kept working for the rest of its eight hours, so changing the password
    // to lock somebody out did not actually lock them out.
    //
    // One second of slack: `iat` has second resolution, and the token issued by the
    // sign-in that made the change is legitimately "the same second".
    if (user.passwordChangedAt && payload.iat) {
      const issuedAtMs = payload.iat * 1000;
      if (issuedAtMs < user.passwordChangedAt.getTime() - 1000) {
        return res
          .status(401)
          .json({ message: 'Your password was changed. Please log in again.' });
      }
    }

    // "Sign out everywhere": the same idea, set on its own by the super admin without a password
    // change. `iat` is whole seconds, so the comparison is in whole seconds too: a token issued in
    // the same second as the sign-out is given the benefit of the doubt, because the alternative is
    // refusing the session of somebody who signed straight back in a fraction later.
    if (user.sessionsRevokedAt && payload.iat) {
      if (payload.iat < Math.floor(user.sessionsRevokedAt.getTime() / 1000)) {
        return res
          .status(401)
          .json({ message: 'You were signed out by the super admin. Please log in again.' });
      }
    }

    // A preview session: the super admin looking at the app exactly as another role sees it.
    //
    // The token says which role to show, and it is honoured only when the real account behind it
    // IS a super admin, and only for reading. A plain copy of the account stands in for the
    // document so that nothing handed `req.user` can save the borrowed role back to the database
    // (a plain object has no `save`), and every write is refused before it reaches a controller.
    if (payload.viewAs) {
      if (user.role !== 'super_admin') {
        return res.status(401).json({ message: 'Session expired. Please log in again.' });
      }
      if (!SAFE_METHODS.has(req.method)) {
        return res.status(403).json({
          message: 'You are previewing another role, which is read-only. Exit the preview to make changes.',
          code: 'preview_read_only',
        });
      }
      req.realUser = user;
      req.user = { ...user.toObject(), id: user.id, role: payload.viewAs, previewOf: user.role };
      req.previewing = payload.viewAs;
      return next();
    }

    noteActivity(user);
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
    }
    return res.status(401).json({ message: 'Session expired. Please log in again.' });
  }
}

// The roles are kept on the function itself. That is what lets the super admin's permission
// matrix (utils/permissionMatrix) be read out of the real routes instead of written out by hand
// and left to drift: the list that decides a request is the list that gets displayed.
function requireRole(...roles) {
  const guard = (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to do this' });
    }
    next();
  };
  guard.roles = roles;
  return guard;
}

module.exports = { requireAuth, requireRole, SAFE_METHODS };
