const Member = require('../models/Member');
const { normalizePhone } = require('./phone');

// The group's public access rule: a registered phone number is the credential
// for the members' area (documents and minutes). Exact match only, active
// members only — the same check the passbook lookup uses, shared here so the
// public controllers can't drift apart on how "registered" is decided.
async function findActiveMemberByPhone(rawPhone) {
  const normalized = normalizePhone(String(rawPhone || ''));
  if (!normalized) return null;
  return Member.findOne({ phone: normalized, active: true }).lean();
}

// 400 for a malformed number, 404 for an unregistered one — the same split the
// passbook lookup makes, so callers can just `return phoneGateError(req, res)`.
function phoneGateError(req, res) {
  if (!normalizePhone(String(req.query.phone || ''))) {
    return res.status(400).json({ message: 'Enter a valid phone number (e.g. 0712 345 678)' });
  }
  return res.status(404).json({ message: 'not_found' });
}

module.exports = { findActiveMemberByPhone, phoneGateError };