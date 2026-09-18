const Member = require('../models/Member');
const { normalizeNationalId } = require('./nationalId');

const ID_ERROR = 'Enter a valid ID number, e.g. 12345678 (or a passport number)';

// The group's public access rule: the ID registered on a member's record is the
// credential for the members' area — his own passbook, the group's documents, the
// minutes and the constitution. Exact match only and active members only, shared
// here so the public controllers can't drift apart on what "registered" means.
//
// Returns `{ member }` on a single match, or `{ error: { status, message } }` for
// the caller to return as it stands: 400 for something that is not an ID at all,
// 404 for an ID nobody holds, 409 when the register has it twice.
async function findActiveMemberByNationalId(rawId) {
  const key = normalizeNationalId(String(rawId ?? ''));
  if (!key) return { error: { status: 400, message: ID_ERROR } };

  // `.limit(2)` is the point of this query. Unlike the phone number, `nationalId`
  // is the office's own free-text field — it holds passports and notes like "not
  // yet issued" — so it has no unique index behind it. If two members ever end up
  // with the same number, showing one of them the other's passbook would be the
  // worst available answer, so the gate refuses instead of picking a row.
  const matches = await Member.find({ nationalId: key, active: true }).limit(2).lean();
  if (!matches.length) return { error: { status: 404, message: 'not_found' } };
  if (matches.length > 1) {
    return {
      error: {
        status: 409,
        message:
          'That ID is recorded on more than one member. Ask the treasurer to check the register.',
      },
    };
  }

  return { member: matches[0] };
}

module.exports = { findActiveMemberByNationalId, ID_ERROR };
