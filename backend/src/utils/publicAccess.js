const crypto = require('crypto');
const Member = require('../models/Member');
const { normalizeNationalId } = require('./nationalId');
const { logEvent } = require('../middleware/requestLogger');

const ID_ERROR = 'Enter a valid ID number, e.g. 12345678 (or a passport number)';

// A failed lookup is the only signal that somebody is guessing at the gate — a rate
// limiter reports its own 429s, not who was being tried. So every refusal is logged,
// with a short hash of the number rather than the number itself: the ID *is* the
// credential, and a log line is a copy of it. The hash is enough to see the same
// one being tried over and over.
function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function denied(reason, id) {
  logEvent('members_gate_denied', { reason, id: fingerprint(id) }, 'warn');
}

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
  if (!key) {
    denied('not_an_id', rawId);
    return { error: { status: 400, message: ID_ERROR } };
  }

  // `.limit(2)` is the point of this query. Unlike the phone number, `nationalId`
  // is the office's own free-text field — it holds passports and notes like "not
  // yet issued" — so a partial unique index (models/Member.js) is what keeps one
  // number on one member now, and this refuses rather than picking a row if two
  // ever slip through.
  const matches = await Member.find({ nationalId: key, active: true }).limit(2).lean();
  if (!matches.length) {
    denied('no_such_member', key);
    return { error: { status: 404, message: 'not_found' } };
  }
  if (matches.length > 1) {
    denied('duplicate_id', key);
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
