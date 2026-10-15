// The code on an M-Pesa confirmation, and whether it has been used before.
//
// The treasurer pastes the confirmation message into a payment's note. That message carries a ten
// character code (SK9X2Q1LMN) that is unique to the transaction, so the same code on two payments
// is almost always the same money entered twice — a double tap on a slow phone, or two officers
// each logging what was in the group chat. It is a warning rather than a refusal: a person can
// confirm it really is a second payment, because a code pasted into a note is only text.

// Ten characters, upper-case letters and digits, starting with a letter. A plain upper-case word of
// ten letters is not a code, so at least one digit is required.
const CODE = /\b[A-Z][A-Z0-9]{9}\b/g;

function extractMpesaCodes(text) {
  const found = String(text || '').match(CODE) || [];
  return [...new Set(found.filter((code) => /\d/.test(code)))];
}

module.exports = { extractMpesaCodes };
