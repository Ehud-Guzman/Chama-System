// The rest of a member's record, as the group's membership admission form asks
// for it: personal details, the family the group would need to reach, the
// applicant's own declaration, and the office bearers who admitted him.
//
// All of it is optional — a member can be added with nothing but a name and a
// phone, which is what the register has for most of the people already in it —
// but whatever is given is cleaned here so the profile and the exports always see
// the same shape.

const APPROVAL_ROLES = ['chairperson', 'secretary', 'treasurer'];
const APPROVAL_LABELS = {
  chairperson: 'Chairperson',
  secretary: 'Secretary',
  treasurer: 'Treasurer',
};

function cleanText(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// Children arrive as names — the form has four ruled lines, but a family is not
// four, so the list is as long as it needs to be. A single string is split on the
// separators somebody would actually type in a spreadsheet cell.
function cleanChildren(value) {
  const raw = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[\n;|]+/);
  return raw
    .map((child) => cleanText(child, 80))
    .filter(Boolean)
    .slice(0, 20);
}

function cleanFamily(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    spouseName: cleanText(source.spouseName),
    children: cleanChildren(source.children),
    fatherName: cleanText(source.fatherName),
    motherName: cleanText(source.motherName),
    fatherInLawName: cleanText(source.fatherInLawName),
    motherInLawName: cleanText(source.motherInLawName),
  };
}

// Reads any stored shape (missing, null, or a legacy row) into the shape the API
// promises the screens, so nothing downstream has to guard for it.
function normaliseFamily(value) {
  return cleanFamily(value);
}

function familyIsEmpty(family) {
  return (
    !family.spouseName &&
    family.children.length === 0 &&
    !family.fatherName &&
    !family.motherName &&
    !family.fatherInLawName &&
    !family.motherInLawName
  );
}

// A date of birth is the one personal field worth refusing: a member added with a
// typo in the year would carry it for ever, and the form's whole point is that the
// office can age-check a claim. Returns { value, error }.
function cleanDateOfBirth(value) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === '') return { value: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: 'Enter a valid date of birth' };
  if (date.getTime() > Date.now()) return { error: 'Date of birth cannot be in the future' };
  if (date.getUTCFullYear() < 1900) return { error: 'Date of birth looks too far back' };
  return { value: date };
}

// The applicant's side of the form: he has read the constitution and accepts the
// weekly commitment. Dated when it is recorded, because "signed" without a date is
// not a record of anything.
function cleanCommitment(input) {
  const source = input && typeof input === 'object' ? input : {};
  const agreed = Boolean(source.agreed);
  return {
    agreed,
    agreedAt: agreed ? source.agreedAt ? new Date(source.agreedAt) : new Date() : null,
    signedBy: cleanText(source.signedBy, 120),
  };
}

// The office's side: chairperson, secretary, treasurer, each with a name and the
// date they signed. An entry without a name is not an approval, so it is dropped
// rather than stored as a blank signature.
function cleanApprovals(input) {
  const list = Array.isArray(input) ? input : [];
  const byRole = new Map();

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const role = cleanText(entry.role, 20).toLowerCase();
    if (!APPROVAL_ROLES.includes(role)) continue;
    const name = cleanText(entry.name, 120);
    if (!name) {
      byRole.delete(role);
      continue;
    }
    const signedAt = entry.signedAt ? new Date(entry.signedAt) : new Date();
    byRole.set(role, {
      role,
      name,
      signedAt: Number.isNaN(signedAt.getTime()) ? new Date() : signedAt,
    });
  }

  // Always in the order the form prints them, so two profiles read the same way.
  return APPROVAL_ROLES.filter((role) => byRole.has(role)).map((role) => byRole.get(role));
}

// Which of the three office bearers have signed, for a screen that wants to say
// "admission pending" without doing the arithmetic itself.
function admissionStatus(member) {
  const signed = new Set((member.approvals || []).map((a) => a.role));
  const missing = APPROVAL_ROLES.filter((role) => !signed.has(role));
  return {
    complete: missing.length === 0,
    missing: missing.map((role) => APPROVAL_LABELS[role]),
    signedCount: APPROVAL_ROLES.length - missing.length,
  };
}

module.exports = {
  APPROVAL_ROLES,
  APPROVAL_LABELS,
  cleanText,
  cleanFamily,
  normaliseFamily,
  familyIsEmpty,
  cleanDateOfBirth,
  cleanCommitment,
  cleanApprovals,
  admissionStatus,
};
