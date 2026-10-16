const Member = require('../models/Member');
const { normalizeNationalId, nationalIdFingerprint } = require('./nationalId');
const { logEvent } = require('../middleware/requestLogger');
const { getOrCreateSettings } = require('./settings');
const { recordGateFailure } = require('./securityEvents');

const ID_ERROR = 'Enter a valid ID number, e.g. 12345678 (or a passport number)';

// What a member is told when the group's phone check is on and the try did not open anything. It is
// the same words, the same status and the same body whether the ID belongs to nobody, belongs to two
// people, or belongs to one person whose phone number was wrong — because any difference between
// those answers is a way to ask the gate "is this number a member?" without owning the number.
const GENERIC_FAILURE = {
  status: 401,
  message: 'We could not open a record with that ID number and phone number. Check both and try again.',
  extra: { phoneRequired: true },
};

// A failed try is the only signal that somebody is guessing at the gate — a rate limiter reports its
// own 429s, not who was being tried. So every refusal is logged with a short hash of the number rather
// than the number itself (the ID *is* the credential, and a log line is a copy of it), and stored
// where the super admin's oversight screen can read it.
function denied(reason, id, { req = null, member = null } = {}) {
  const target = nationalIdFingerprint(id);
  logEvent('members_gate_denied', { reason, id: target }, 'warn');
  void recordGateFailure({
    reason,
    target,
    ip: req && req.ip,
    rid: req && req.id,
    member,
  });
}

// The group's public access rule: the ID registered on a member's record is the
// credential for the members' area — his own passbook, the group's documents, the
// minutes and the constitution. Exact match only and active members only, shared
// here so the public controllers can't drift apart on what "registered" means.
//
// Returns `{ member }` on a single match, or `{ error: { status, message } }` for
// the caller to return as it stands: 400 for something that is not an ID at all,
// 404 for an ID nobody holds, 409 when the register has it twice.
//
// This is where an ID is *spent*. Past it the member holds a pass (utils/memberToken) and the number
// is not asked for again.
async function findActiveMemberByNationalId(rawId, req = null) {
  const key = normalizeNationalId(String(rawId ?? ''));
  if (!key) {
    denied('not_an_id', rawId, { req });
    return { error: { status: 400, message: ID_ERROR } };
  }

  // `.limit(2)` is the point of this query. Unlike the phone number, `nationalId`
  // is the office's own free-text field — it holds passports and notes like "not
  // yet issued" — so a partial unique index (models/Member.js) is what keeps one
  // number on one member now, and this refuses rather than picking a row if two
  // ever slip through.
  const matches = await Member.find({ nationalId: key, active: true }).limit(2).lean();
  if (!matches.length) {
    denied('no_such_member', key, { req });
    return { error: { status: 404, message: 'not_found' } };
  }
  if (matches.length > 1) {
    denied('duplicate_id', key, { req });
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

// The last nine digits of a phone number, whichever way it was written: 0712 345 678,
// +254712345678 and 254712345678 are the same phone. Nine is the Kenyan national number. Empty when
// there are not nine digits to compare.
function phoneTail(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

// The members' passbook: his ID, and — when the group has switched it on — the phone number
// registered on his record as well (Settings.passbookPhoneCheck).
//
// An ID is on a card and in other people's phones, so on its own it is a weak door to somebody's
// balance, fines and payments. A phone number is something he knows without looking it up and a
// stranger holding his ID card usually does not. Only the passbook asks: the group's documents,
// minutes and constitution are the group's papers, not one member's money, and stay on the ID alone.
//
// Read from the request BODY (POST), never the URL: the number and the phone are credentials, and a
// URL is copied into browser history and into every log between the phone and the server.
//
// Same return shape as the ID gate, plus `phoneVerified` on success. With the check on, every refusal
// that depends on the register is the one GENERIC_FAILURE above; with it off there is nothing more to
// protect than the ID, so the gate keeps its plain 404 and 409.
async function openPassbook(req) {
  const input = req.body || {};
  const settings = await getOrCreateSettings();
  const phoneCheck = Boolean(settings.passbookPhoneCheck);

  const gate = await findActiveMemberByNationalId(input.nationalId, req);
  if (gate.error) {
    // "That is not an ID" says nothing about the register, so it can stay specific.
    if (phoneCheck && gate.error.status !== 400) return { error: GENERIC_FAILURE };
    return gate;
  }
  if (!phoneCheck) return { member: gate.member, phoneVerified: false };

  const given = phoneTail(input.phone);
  const registered = phoneTail(gate.member.phone);
  if (!given || given !== registered) {
    denied(given ? 'wrong_phone' : 'phone_missing', input.nationalId, { req, member: gate.member });
    return { error: GENERIC_FAILURE };
  }
  return { member: gate.member, phoneVerified: true };
}

module.exports = {
  findActiveMemberByNationalId,
  openPassbook,
  phoneTail,
  ID_ERROR,
  GENERIC_FAILURE,
};
