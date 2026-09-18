// Mirrors the backend normalizer (backend/src/utils/nationalId.js) for instant
// client-side validation, so a member's ID is judged the same way in the browser
// as it is at the gate. Spaces, dashes, slashes and dots come out and letters go
// up: " 12 345 678 " and "12345678" are one ID, and a passport number typed as
// "ak 1234567" is the same as "AK1234567".
export function normalizeNationalId(input) {
  const cleaned = String(input == null ? '' : input)
    .replace(/[\s\-/.,]/g, '')
    .toUpperCase();

  if (cleaned.length < 5 || cleaned.length > 20) return null;
  if (!/^[A-Z0-9]+$/.test(cleaned)) return null;
  if (!/\d/.test(cleaned)) return null;
  return cleaned;
}

// Shown back in the members' area ("unlocked for …"), so a shared screen or a
// screenshot does not spell out a credential the whole gate rides on.
export function maskNationalId(id) {
  const value = String(id || '');
  if (value.length < 5) return value;
  return '•'.repeat(value.length - 3) + value.slice(-3);
}

// Whether a record's `nationalId` is a usable key at all. The field also holds
// notes like "not yet issued", and a note opens nothing — which is what the
// office's "N members still cannot open their record" line counts.
export function nationalIdMissing(value) {
  return !normalizeNationalId(value);
}

// One wording for every gate that asks for an ID — the lookup, the records card
// and the constitution all say the same thing, because they ask the same thing.
export const NATIONAL_ID_ERROR =
  'Enter a valid ID number, e.g. 12345678 (or a passport number)';
