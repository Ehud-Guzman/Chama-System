// The three fields on a member's record that are somebody's door rather than a description of him.
//
//   * his ID number is the key to his own record, and to the members' area — the group's papers,
//     its minutes and the constitution;
//   * his phone number is how the office reaches him, and it was the members' old public key;
//   * his next of kin is somebody else's contact details, kept because a chama has to be able to
//     reach a family in an emergency.
//
// The treasurer keeps the register: adding members, editing them, resigning them, printing their
// statements, importing a whole sheet of them. This is the one corner of it that is not his.
// Recording a value that is not there yet is ordinary office work — most of the register was
// entered from a name and a phone number, and the office is actively chasing the members who have
// no ID — but *replacing* a value already on a record is an admin's decision, so that the person
// who keeps the books is not also the person who can re-key a member's door, or take the number
// off it.
//
// The controller normalises both sides before calling (the phone through normalizePhone, the ID
// through storedNationalId, the contacts through nextOfKinList), so this file only has to decide —
// which is what makes it testable without a database.

const ADMIN_ROLES = ['super_admin', 'admin'];

const CREDENTIAL_FIELDS = {
  nationalId: 'ID number',
  phone: 'phone number',
  nextOfKin: 'next of kin',
};

// Whether a value is worth protecting. A blank field, or an empty list, is one the office is
// still filling in, and filling it in is allowed.
function isRecorded(value) {
  if (Array.isArray(value)) return value.length > 0;
  return String(value == null ? '' : value).trim() !== '';
}

function sameValue(before, after) {
  if (Array.isArray(before) || Array.isArray(after)) {
    return JSON.stringify(before || []) === JSON.stringify(after || []);
  }
  return String(before == null ? '' : before).trim() === String(after == null ? '' : after).trim();
}

// `changes` is [{ field, before, after }] with both sides already normalised. Returns the sentence
// for the first change this role may not make, or null when it may make all of them.
//
// Refusing is a 403 rather than a silent drop: a treasurer who edits a member's phone number has
// to be told the number is not his to change, or he will believe the change was saved.
function credentialChangeRefused(role, changes) {
  if (ADMIN_ROLES.includes(role)) return null;

  for (const change of changes) {
    const label = CREDENTIAL_FIELDS[change.field];
    if (!label) continue;
    if (!isRecorded(change.before)) continue;
    if (sameValue(change.before, change.after)) continue;
    return `Only an admin can change a member's ${label}. Ask an admin to make that change.`;
  }

  return null;
}

module.exports = {
  ADMIN_ROLES,
  CREDENTIAL_FIELDS,
  isRecorded,
  sameValue,
  credentialChangeRefused,
};
