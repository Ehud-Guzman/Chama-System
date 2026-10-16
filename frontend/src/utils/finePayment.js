// The extension is explicit because Node's resolver needs one and Vite does not — the same rule
// services/api.js follows so its module can be imported by `node --test`.
import { money } from './format.js';

// What taking a fine payment means, worked out before the office presses the button.
//
// A payment is either taken out of the member's balance (the group already holds that money for
// him, so his balance goes down) or paid in cash on the side (his balance is untouched). The
// payment screen shows both outcomes beside each other and the sentence under the amount says what
// *this* choice will do — so the figures here are the ones the office checks against the member in
// front of it. Pure and free of React, so the arithmetic is covered by test/finePayment.test.js.

// Two decimal places, as the server stores money.
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Pay settles everything the member owes in one go, oldest fine first (the order the server uses),
// and every fine keeps its own line. From his balance the money runs out where his balance does: the
// fines before that point are cleared, the one it stops in is part paid, the rest stay owed. In
// cash everything is cleared. Returns one row per fine, in the order given.
//
// `paidOn` is the day the money changed hands (YYYY-MM-DD). A fine issued after that day cannot have
// been paid on it, so the server leaves it alone and so does this: its row says `later`.
export function allocateFines(fines = [], { held = 0, source = null, paidOn = null } = {}) {
  const payable = (f) => !(paidOn && f.date && eatDay(f.date) > paidOn);
  const owedTotal = cents(
    fines.filter(payable).reduce((sum, f) => sum + (Number(f.remaining) || 0), 0)
  );
  let budget = source === 'balance' ? Math.min(owedTotal, Math.max(0, cents(held))) : owedTotal;
  return fines.map((f) => {
    const remaining = cents(Number(f.remaining) || 0);
    const later = !payable(f);
    const paying = source && !later ? cents(Math.min(budget, remaining)) : 0;
    budget = cents(budget - paying);
    return { ...f, paying, later, remainingAfter: cents(remaining - paying) };
  });
}

// The calendar day of a moment on the group's own clock (East Africa Time, UTC+3, the day the server
// compares fines and payments by), as YYYY-MM-DD.
export function eatDay(value) {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t + 3 * 3600 * 1000).toISOString().slice(0, 10) : '';
}

// Everything the screen says about the payment before it is pressed: whether it can be recorded,
// how much will be paid, what is left owing afterwards and, from his balance, what he holds.
export function paymentPreview({ fines = [], held = 0, source = null, paidOn = null }) {
  const owed = cents(fines.reduce((sum, f) => sum + (Number(f.remaining) || 0), 0));
  const have = Math.max(0, cents(held));
  const unpaid = allocateFines(fines, { paidOn });

  if (fines.length === 0 || owed <= 0) {
    return { valid: false, problem: 'He owes no fines', rows: [], total: 0, owedAfter: 0, heldAfter: null };
  }
  if (unpaid.every((r) => r.later)) {
    return { valid: false, problem: 'Every fine was issued after that date', rows: unpaid, total: 0, owedAfter: owed, heldAfter: null };
  }
  if (source !== 'balance' && source !== 'cash') {
    return { valid: false, problem: 'Choose how it was paid', rows: unpaid, total: 0, owedAfter: owed, heldAfter: null };
  }
  if (source === 'balance' && have <= 0) {
    return {
      valid: false,
      problem: 'The group is not holding any money for him, so there is nothing to take it from.',
      rows: unpaid,
      total: 0,
      owedAfter: owed,
      heldAfter: null,
    };
  }
  const rows = allocateFines(fines, { held: have, source, paidOn });
  const total = cents(rows.reduce((sum, r) => sum + r.paying, 0));
  return {
    valid: total > 0,
    problem: '',
    rows,
    total,
    owedAfter: cents(owed - total),
    heldAfter: source === 'balance' ? cents(have - total) : null,
  };
}

// How a payment reached the group, in the words the screen uses for it.
export function sourceLabel(source) {
  if (source === 'balance') return 'Taken from his balance';
  if (source === 'cash') return 'Paid in cash / M-Pesa';
  if (source === 'contribution') return 'Out of a contribution';
  return 'Recorded earlier — not yet checked';
}

// The same payment, written to the member himself: what the office sends him when email cannot
// reach him. Plain, short and in the second person, because it is read on a phone as a message.
export function paymentMessage({ memberName, totalApplied, source, held, owedAfter }) {
  const first = String(memberName || '').split(' ')[0] || 'there';
  const paid =
    source === 'balance'
      ? `We have taken ${money(totalApplied)} from your balance with the group to pay your fines.`
      : `We have received your fine payment of ${money(totalApplied)}.`;
  const balance = held ? ` The group now holds ${money(held.after)} for you.` : '';
  const left = owedAfter > 0 ? ` You still owe ${money(owedAfter)} in fines.` : ' You owe no more fines.';
  return `Hello ${first}, ${paid}${balance}${left} Thank you.`;
}

// The sentence that closes a payment: what was recorded and what it did.
export function paymentSummary({ memberName, totalApplied, source, held, owedAfter }) {
  const name = memberName || 'The member';
  const head =
    source === 'balance'
      ? `${money(totalApplied)} was taken from ${name}’s balance.`
      : `${money(totalApplied)} paid by ${name} was recorded.`;
  const balance = held ? ` The group now holds ${money(held.after)} for him.` : '';
  const left =
    owedAfter > 0 ? ` He still owes ${money(owedAfter)} in fines.` : ' He owes no more fines.';
  return `${head}${balance}${left}`;
}
