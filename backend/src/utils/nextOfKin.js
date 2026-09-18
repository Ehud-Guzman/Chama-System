const { cleanEmail, isValidEmail } = require('./mailer');

// A member's next-of-kin list — the people the office calls in an emergency.
//
// It is a list rather than one contact because that is what a family looks like:
// a spouse, the children, the in-laws the group would need to reach. Each entry
// is embedded in the member document (never its own collection) because it is
// only ever read together with him.
//
// Older records still hold a single object on `member.nextOfKin`. Every read goes
// through nextOfKinList(), which accepts either shape, so introducing the list
// needed no migration and no compatibility branch at the call sites.

// Suggestions offered in the admin form. Deliberately not enforced: a relative
// who fits none of them is still written in ("Uncle", "Nyumbani", ...).
const KIN_RELATIONSHIPS = [
  'Spouse',
  'Son',
  'Daughter',
  'Child',
  'Father',
  'Mother',
  'Brother',
  'Sister',
  'In-law',
  'Guardian',
  'Next of kin',
  'Other',
];

// One contact, cleaned. Every field is optional — the document stores what the
// office knew at the time.
function cleanKinEntry(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    name: String(source.name || '').trim(),
    relationship: String(source.relationship || '').trim(),
    // Not normalized like the member's own phone: this is often a relative's
    // number, which may be a landline or a non-Kenyan mobile.
    phone: String(source.phone || '').trim(),
    email: cleanEmail(source.email),
  };
}

// Any shape (null, a legacy single contact, or the list) turned into a clean
// list. Entries with no name and no way to reach anybody are dropped: that is how
// the form clears a contact the member no longer wants listed.
function nextOfKinList(value) {
  const raw = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  return raw.map(cleanKinEntry).filter((kin) => kin.name || kin.phone || kin.email);
}

// Returns an error message, or null when the contact is usable. A name with no
// way to reach anyone is the one combination worth rejecting: in the emergency
// this field exists for, it would be useless.
function nextOfKinError(kin) {
  const empty = !kin.name && !kin.phone && !kin.email;
  if (empty) return null;
  if (!kin.name) return 'Every next of kin needs a name';
  if (kin.phone && !/^[+\d][\d\s\-()]{6,}$/.test(kin.phone)) {
    return `Enter a valid phone number for ${kin.name}`;
  }
  if (!isValidEmail(kin.email)) return `Enter a valid email address for ${kin.name}`;
  if (!kin.phone && !kin.email) {
    return `Add a phone number or an email for ${kin.name}`;
  }
  return null;
}

// The first unusable contact's message, or null when the whole list is fine.
function nextOfKinListError(list) {
  for (const kin of list) {
    const error = nextOfKinError(kin);
    if (error) return error;
  }
  return null;
}

module.exports = {
  KIN_RELATIONSHIPS,
  cleanKinEntry,
  nextOfKinList,
  nextOfKinError,
  nextOfKinListError,
};
