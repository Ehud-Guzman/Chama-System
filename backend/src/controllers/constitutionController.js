const { constitutionMeta, constitutionChapters } = require('../data/constitution');
const { findActiveMemberByPhone, phoneGateError } = require('../utils/publicAccess');

// GET /api/public/constitution?phone= — MEMBERS ONLY.
//
// The constitution is the group's own document, so it sits behind the same gate
// as the document vault and the minutes: a phone number registered to an active
// member, or nothing at all.
//
// The text is served from here rather than bundled into the public JavaScript on
// purpose. A reader that shipped the whole constitution to the browser and merely
// hid it behind a click would leave it one devtools download away for anyone who
// never signed in — the gate would be decorative. Anything a member is not meant
// to see without proving their number has to come from the server.
async function publicConstitution(req, res, next) {
  try {
    const member = await findActiveMemberByPhone(req.query.phone);
    if (!member) return phoneGateError(req, res);

    // Never let a shared device or a proxy cache a document unlocked by a phone
    // number — the same rule the document vault follows.
    res.setHeader('Cache-Control', 'no-store');
    res.json({ meta: constitutionMeta, chapters: constitutionChapters });
  } catch (err) {
    next(err);
  }
}

module.exports = { publicConstitution };
