// Mirrors the backend normalizer (backend/src/utils/phone.js) for instant
// client-side validation — +2547…, 2547…, and 07… all resolve to 07XXXXXXXX.
export function normalizePhone(input) {
  let digits = String(input == null ? '' : input).replace(/[\s\-().]/g, '');

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }

  if (!/^\d+$/.test(digits)) {
    return null;
  }

  if (digits.length === 12 && digits.startsWith('254')) {
    digits = '0' + digits.slice(3);
  } else if (digits.length === 9 && /^[17]/.test(digits)) {
    digits = '0' + digits;
  }

  return /^0[17]\d{8}$/.test(digits) ? digits : null;
}

// Same masking the backend applies to the passbook: keep the first two
// and last three digits. Phones are always the fixed 10-char format, so slicing
// at fixed offsets is safe.
export function maskPhone(phone) {
  const value = String(phone || '');
  if (value.length < 10) return value;
  return `${value.slice(0, 2)}XX XXX ${value.slice(7)}`;
}