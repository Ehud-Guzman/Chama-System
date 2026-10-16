const bcrypt = require('bcryptjs');
const User = require('../models/User');

// "Type your password again" — for the handful of super-admin actions that cannot be taken back
// and should not happen because a phone was left unlocked on a desk: a restore, a role change,
// wiping rehearsal data, merging two members.
//
// A signed-in session proves who was at the keyboard when the token was issued, not who is there
// now. Asking again is the cheap, familiar way to prove it.
//
// A wrong password answers 403, never 401: the front end treats every 401 on an admin page as
// "your session ended" and signs the user out, which is the wrong response to a typo.
async function checkPassword(req) {
  const password = req.body?.password;
  if (!password) {
    return { ok: false, status: 400, message: 'Type your password to confirm this.' };
  }
  const user = await User.findById(req.user._id).select('+password');
  const matches = user ? await bcrypt.compare(String(password), user.password) : false;
  if (!matches) {
    return { ok: false, status: 403, message: 'That password is not right.', code: 'bad_password' };
  }
  return { ok: true };
}

// Sends the refusal for a failed check; returns true when the request was answered.
function refuseUnlessConfirmed(result, res) {
  if (result.ok) return false;
  res.status(result.status).json({ message: result.message, ...(result.code ? { code: result.code } : {}) });
  return true;
}

// The typed phrase for an irreversible action. Case and surrounding space are forgiven; the words
// are not — the point is that the person had to read them.
function phraseMatches(given, expected) {
  return String(given || '').trim().toLowerCase() === String(expected).trim().toLowerCase();
}

module.exports = { checkPassword, refuseUnlessConfirmed, phraseMatches };
