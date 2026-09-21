const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Only one algorithm is ever accepted. Without this, `verify` will happily check a
// token against whatever the header claims — the classic way a deployment ends up
// trusting an HS256 token signed with a public key.
const ALGORITHMS = ['HS256'];

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

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
    }
    return res.status(401).json({ message: 'Session expired. Please log in again.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to do this' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
