// The ticket a member holds after he has proved who he is.
//
// Until now the ID number *was* the ticket: the documents list, every minute, every file, the
// constitution and each chapter decision re-sent it, in the URL, on every request. That meant the
// credential was written into history and into every log between the phone and the server dozens of
// times a visit, and it meant each of those endpoints was a fresh place to guess IDs from.
//
// Now the ID is spent once — at the lookup, or at the records gate — and what comes back is this: a
// signed, one-hour pass for that member alone, sent in a header. Everything else in the members' area
// asks for the pass, not the number.
//
//   * It cannot be mistaken for an office session. It carries `scope: 'member'`, which
//     middleware/auth refuses outright, and an office token carries `scope: 'session'`, which this
//     refuses. Neither opens the other's doors.
//   * It is not trusted past what it says. The member is read again on every use, so one who has left
//     the group stops working at once rather than at expiry.
//   * It remembers *how* it was earned. `ph` is true only when the phone number was checked too.
//     The passbook and its statements need it whenever the group has the phone check on, so a pass
//     earned with an ID alone cannot be carried into somebody's balance.
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Member = require('../models/Member');
const { getOrCreateSettings } = require('./settings');

const TTL_SECONDS = 60 * 60;
const HEADER = 'x-member-token';
const ALGORITHMS = ['HS256'];

function signMemberToken(member, { phoneVerified = false } = {}) {
  return jwt.sign(
    { scope: 'member', sub: String(member._id), ph: Boolean(phoneVerified) },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: TTL_SECONDS }
  );
}

function ended(res, message) {
  return res.status(401).json({
    message: message || 'Your session has ended. Enter your ID number again.',
    sessionEnded: true,
  });
}

// Route middleware. `passbook: true` is for the passbook's own statements, which are his money.
// Sets `req.member` (a lean document) and `req.memberAccess`.
function requireMember({ passbook = false } = {}) {
  return async (req, res, next) => {
    try {
      const token = req.get(HEADER);
      if (!token) return ended(res);

      let payload;
      try {
        payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ALGORITHMS });
      } catch {
        return ended(res);
      }
      if (payload.scope !== 'member' || !mongoose.isValidObjectId(payload.sub)) return ended(res);

      const member = await Member.findOne({ _id: payload.sub, active: true }).lean();
      if (!member) return ended(res);

      if (passbook) {
        const settings = await getOrCreateSettings();
        if (settings.passbookPhoneCheck && !payload.ph) {
          return ended(res, 'Open your passbook again with your ID number and phone number.');
        }
      }

      req.member = member;
      req.memberAccess = { phoneVerified: Boolean(payload.ph) };
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { signMemberToken, requireMember, TTL_SECONDS, HEADER };
