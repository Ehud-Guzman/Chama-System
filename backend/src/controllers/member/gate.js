// The members' controller, part: gate. controllers/memberController.js is the index the routes use.

const { openPassbook, findActiveMemberByNationalId } = require('../../utils/publicAccess');
const { signMemberToken, TTL_SECONDS } = require('../../utils/memberToken');
const { buildPublicProfile } = require('./profile');

// POST /api/public/lookup { nationalId, phone? } — PUBLIC, behind the gate guard, EXACT match only.
//
// A POST so that the ID and the phone number travel in the body: in a URL they would sit in browser
// history and in every proxy log on the way. What comes back is the passbook and, beside it, the pass
// (utils/memberToken) that the statements and the members' area use from here on.
async function publicLookup(req, res, next) {
  try {
    // Exact match is enforced inside the gate — no regex, no partial search, one
    // member or none.
    const gate = await openPassbook(req);
    if (gate.error) {
      return res.status(gate.error.status).json({ message: gate.error.message, ...(gate.error.extra || {}) });
    }

    // The ID that just matched IS the credential, so this caller is the member — and, when the group
    // asks for the phone number too, he has given that as well, which is what unlocks his contacts.
    const profile = await buildPublicProfile(gate.member, {
      self: true,
      contactsVerified: gate.phoneVerified,
    });
    res.json({
      ...profile,
      memberToken: signMemberToken(gate.member, { phoneVerified: gate.phoneVerified }),
      memberTokenExpiresIn: TTL_SECONDS,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/public/records/unlock { nationalId } — PUBLIC, behind the gate guard.
//
// The door to the group's papers (documents, minutes, constitution). These stay on the ID alone — they
// are the group's, not one member's money — so the pass it hands out says the phone was NOT checked
// and will not open a passbook while the group's phone check is on.
async function unlockRecords(req, res, next) {
  try {
    const gate = await findActiveMemberByNationalId(req.body && req.body.nationalId, req);
    if (gate.error) {
      return res.status(gate.error.status).json({ message: gate.error.message });
    }
    res.json({
      memberToken: signMemberToken(gate.member, { phoneVerified: false }),
      memberTokenExpiresIn: TTL_SECONDS,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  publicLookup,
  unlockRecords,
};
