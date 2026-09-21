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
//
// It is also the one field whose *format* has to be read carefully, because the office writes
// dates the way Kenya writes them and JavaScript does not read them that way. The form posts
// `YYYY-MM-DD`, which is unambiguous; a spreadsheet the office fills in is not. `17/04/1990` was
// refused (there is no month 17, which is what gave the game away) but `05/04/1990` was read as
// American month-first and silently stored as 4 May when the treasurer meant 5 April — a wrong
// birth date on a record that is used to age-check a claim, with nothing to say so.
//
// So an all-numeric date is read day-first here, the way this group writes one. A two-digit year
// is read as the century a birth date plausibly falls in, and anything that has no sensible
// reading at all is still refused rather than guessed at.
const TYPED_DATE = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;

// The instant midnight UTC on a date the office typed, or null if it is not one.
function typedCalendarDate(text) {
  const parts = TYPED_DATE.exec(text);
  if (!parts) return null;

  // Four digits in the first slot mean it is already the year, so the date is ISO.
  const [, first, second, third] = parts;
  const [day, month, year] = first.length === 4 ? [third, second, first] : [first, second, third];

  const fullYear =
    year.length === 4 ? Number(year) : Number(year) < 30 ? 2000 + Number(year) : 1900 + Number(year);
  const d = Number(day);
  const m = Number(month);
  if (m < 1 || m > 12 || d < 1 || d > 31 || fullYear < 1000) return null;

  // Constructed in UTC, matching what a bare 'YYYY-MM-DD' has always produced, so ISO input is
  // untouched by this and a date does not move a day depending on the server's timezone.
  const date = new Date(Date.UTC(fullYear, m - 1, d));
  // A day that month does not have — 31 April — is a typo. JavaScript would roll it forward into
  // May and hand back a date nobody wrote, which is exactly the kind of quiet wrong answer this
  // function exists to prevent.
  if (date.getUTCDate() !== d || date.getUTCMonth() !== m - 1) return null;
  return date;
}

function cleanDateOfBirth(value) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === '') return { value: null };
  const typed = typeof value === 'string' ? typedCalendarDate(value.trim()) : null;
  // Anything that is not an all-numeric date is left to the platform: a Date the API sent, or a
  // spelled-out date like "17 Apr 1990".
  const date = typed || new Date(value);
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
