// The "who owes what" list: which rows to show, in what order, and what the line above
// them says.
//
// Kept out of the component because it is the part that can be wrong in a way somebody
// acts on — a list that hides a member, or says "12 members owe" when it means 21 — and
// the frontend's tests cover pure logic only (no DOM, nothing added to package.json).

export const OWED_SORTS = [
  { value: 'outstanding', label: 'Most owed' },
  { value: 'fines', label: 'Most fines' },
  { value: 'oldest', label: 'Longest owing' },
  { value: 'name', label: 'Name' },
];

// A member's fine rows arrive as the report's own shape: { name, regNumber, phone,
// outstanding, fines, oldestUnpaid, types }.
function timeOf(value) {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(at) ? Infinity : at;
}

// Only the members who actually owe something. The report itself keeps everyone who was
// ever fined — that is a different question — so this is what the list filters on.
export function owingOnly(members = []) {
  return members.filter((member) => Number(member.outstanding) > 0);
}

// The last nine digits of a Kenyan number, whichever way it was written: 0712 345 678,
// +254712345678 and 254712345678 are the same phone. Nine is the national number, so a
// search can be typed with or without the country code or the leading zero.
function phoneTail(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

// Whether a row matches what has been typed into the search box. Name, registration
// number and phone, because those are the three things the office has in front of it —
// a printed register, a phone, or an M-Pesa message.
export function matchesOwedTerm(member, term) {
  const query = String(term || '').trim().toLowerCase();
  if (!query) return true;

  const haystack = [member.name, member.regNumber, member.phone, member.nationalId]
    .map((field) => String(field || '').toLowerCase());
  if (haystack.some((field) => field.includes(query))) return true;

  // A phone typed with spaces, or as +254…, still finds the member.
  const typed = phoneTail(query);
  if (!typed) return false;
  return phoneTail(member.phone) === typed;
}

export function sortOwed(members = [], sort = 'outstanding') {
  const rows = [...members];
  if (sort === 'name') {
    return rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }
  if (sort === 'fines') {
    return rows.sort(
      (a, b) => Number(b.fines || 0) - Number(a.fines || 0) || Number(b.outstanding || 0) - Number(a.outstanding || 0)
    );
  }
  if (sort === 'oldest') {
    // Longest owing first; a member with no dated debt sorts last rather than first.
    return rows.sort((a, b) => timeOf(a.oldestUnpaid) - timeOf(b.oldestUnpaid));
  }
  return rows.sort(
    (a, b) => Number(b.outstanding || 0) - Number(a.outstanding || 0) || Number(b.fines || 0) - Number(a.fines || 0)
  );
}

export function searchOwed(members = [], term = '', sort = 'outstanding') {
  return sortOwed(owingOnly(members).filter((member) => matchesOwedTerm(member, term)), sort);
}

// The line above the list: how many owe, how much between them, and how far back the
// oldest debt goes. Computed from the rows in hand so it can never describe a list that
// disagrees with itself.
export function owedSummary(members = []) {
  const owing = owingOnly(members);
  const oldest = owing.reduce((acc, member) => {
    const at = timeOf(member.oldestUnpaid);
    if (at === Infinity) return acc;
    return acc === null || at < acc ? at : acc;
  }, null);

  return {
    members: owing.length,
    fines: owing.reduce((sum, member) => sum + Number(member.fines || 0), 0),
    total: owing.reduce((sum, member) => sum + Number(member.outstanding || 0), 0),
    oldest: oldest === null ? null : new Date(oldest),
  };
}
