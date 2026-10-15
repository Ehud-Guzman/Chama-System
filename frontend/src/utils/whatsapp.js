// A WhatsApp message ready to send, for the members email does not reach.
//
// Reminders and fine notices go out by email, and a member with no address on file is never told.
// A WhatsApp chat link needs no account with a messaging provider and no credentials: it opens the
// office's own WhatsApp with the member's number and the words already typed, and a person presses
// send. Nothing is sent by the system, which is also why it can be offered to anybody.
//
// Kenyan numbers are written 0712…, 712…, +254712… or 254712…, and WhatsApp wants the country code
// without a plus. Anything that does not come out as a plausible number gives null, and the screen
// shows no button rather than one that opens a chat with a stranger.

export function whatsappNumber(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  let national = '';
  if (digits.length === 12 && digits.startsWith('254')) national = digits.slice(3);
  else if (digits.length === 10 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 9) national = digits;
  // Safaricom, Airtel and the rest all start 7 or 1 once the leading zero is gone.
  if (!/^[17]\d{8}$/.test(national)) return null;
  return `254${national}`;
}

export function whatsappLink(phone, text) {
  const number = whatsappNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(String(text || ''))}`;
}
