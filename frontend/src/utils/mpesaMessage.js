// What can be read off a pasted M-Pesa confirmation, so the treasurer does not retype it.
//
//   SK9X2Q1LMN Confirmed. Ksh1,400.00 sent to WAZO MOJA on 17/9/26 at 8:04 AM.
//   QJK7YU90AB Confirmed.You have received Ksh1,400.00 from JANE WANJIRU 0712345678.
//
// The first amount in the message is the transaction (the balance and the transaction cost come
// after it), and the code is ten upper-case letters and digits that start with a letter.
// Nothing here is ever applied on its own: the screen offers the amount as a button and the
// treasurer decides, because a message can be about something else entirely.
export function parseMpesaMessage(text) {
  const source = String(text || '');

  const code = (source.match(/\b[A-Z][A-Z0-9]{9}\b/g) || []).find((c) => /\d/.test(c)) || null;

  const found = /Ksh\.?\s*([\d,]+(?:\.\d{1,2})?)/i.exec(source);
  const amount = found ? Number(found[1].replace(/,/g, '')) : NaN;

  return { code, amount: Number.isFinite(amount) && amount > 0 ? amount : null };
}
