// Quick-send links only — no backend integration, no third-party account
// needed. These open the admin's own WhatsApp/email app with the message
// pre-filled; the admin reviews and sends it themselves.

// Converts a normalized local number (0712345678) to WhatsApp's international
// format (254712345678). Falls back to stripping a leading 0 for anything
// that doesn't match the expected shape, rather than failing silently.
function toInternational(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  return digits.replace(/^0/, '254');
}

export function whatsappLink(phone, message) {
  const intl = toInternational(phone);
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

export function mailtoLink(email, subject, body) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
