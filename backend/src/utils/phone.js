// Single standard phone format: 07XXXXXXXX (or 01XXXXXXXX).
// Accepts +2547..., 2547..., 07..., 7... and normalizes them all.
// Returns the normalized string, or null if the input is not a valid Kenyan mobile number.
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;

  if (digits.length === 12 && digits.startsWith('254')) {
    digits = '0' + digits.slice(3);
  } else if (digits.length === 9 && /^[17]/.test(digits)) {
    digits = '0' + digits;
  }

  return /^0[17]\d{8}$/.test(digits) ? digits : null;
}

module.exports = { normalizePhone };
