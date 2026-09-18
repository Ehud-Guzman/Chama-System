// The national ID is the credential for the members' area: the number a member
// types to open his own passbook, the group's documents, the minutes and the
// constitution. Cards carry it with spaces, dashes or slashes, and a passport
// number has letters in it — so the value the office stores and the value the
// member types both go through this one normalizer. Two rules would otherwise
// drift and a member with a correctly registered ID would be told he has none.
//
// Free text is deliberately not an ID. The `nationalId` field also holds notes
// like "not yet issued" (see the Member model), and a note must never open a
// record — hence the digit requirement below.
function normalizeNationalId(input) {
  const cleaned = String(input ?? '')
    .replace(/[\s\-/.,]/g, '')
    .toUpperCase();

  if (cleaned.length < 5 || cleaned.length > 20) return null;
  if (!/^[A-Z0-9]+$/.test(cleaned)) return null;
  if (!/\d/.test(cleaned)) return null;
  return cleaned;
}

// What gets written to the member record: the normalised ID when the office
// typed one, otherwise the note exactly as written, so the profile still says
// what the paper form says. normalizeNationalId() is the single judge of what
// counts as an ID — everything else is stored but cannot open anything.
function storedNationalId(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  return normalizeNationalId(raw) || raw.slice(0, 40);
}

module.exports = { normalizeNationalId, storedNationalId };
