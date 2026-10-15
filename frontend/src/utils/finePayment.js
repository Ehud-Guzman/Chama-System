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

// An amount typed into a field: "1,500", "1 500" and "1500" are the same figure. NaN when it is not
// a number at all, so the caller can tell "empty" from "zero".
export function parseAmount(text) {
  const cleaned = String(text ?? '').replace(/[,\s]/g, '');
  if (cleaned === '') return NaN;
  return Number(cleaned);
}

// What is owed on one fine: the most a payment against it can be. Nothing is spread over several
// fines — each payment is for the single fine chosen.
export function owedFor(fines = [], fineId = null) {
  const one = fines.find((f) => String(f.id) === String(fineId));
  return one ? cents(Number(one.remaining) || 0) : 0;
}

// Whether the balance can pay for it, and the sentence to show when it cannot.
export function balanceChoice({ held, amount }) {
  const have = Math.max(0, cents(held));
  const want = cents(amount);
  if (have <= 0) {
    return { allowed: false, reason: 'The group is not holding any money for him, so there is nothing to take it from.' };
  }
  if (Number.isFinite(want) && want > have) {
    return {
      allowed: false,
      reason: `He holds only ${money(have)}. Take that much, and record the rest as paid in cash.`,
    };
  }
  return { allowed: true, reason: '' };
}

// Everything the screen says about the payment as typed: whether it can be recorded, what is left
// to pay afterwards and, for a payment taken from his balance, what he holds afterwards.
export function paymentPreview({ owed, held, amount, source }) {
  const value = Number.isFinite(amount) ? cents(amount) : NaN;
  const total = cents(owed);
  const have = Math.max(0, cents(held));

  if (!Number.isFinite(value) || value <= 0) {
    return { valid: false, problem: 'Enter the amount paid', owedAfter: total, heldAfter: null };
  }
  if (value > total) {
    return {
      valid: false,
      problem: `That is more than the ${money(total)} owed`,
      owedAfter: total,
      heldAfter: null,
    };
  }
  if (source === 'balance') {
    const choice = balanceChoice({ held: have, amount: value });
    if (!choice.allowed) {
      return { valid: false, problem: choice.reason, owedAfter: cents(total - value), heldAfter: null };
    }
    return { valid: true, problem: '', owedAfter: cents(total - value), heldAfter: cents(have - value) };
  }
  if (source === 'cash') {
    return { valid: true, problem: '', owedAfter: cents(total - value), heldAfter: null };
  }
  return { valid: false, problem: 'Choose how it was paid', owedAfter: cents(total - value), heldAfter: null };
}

// How a payment reached the group, in the words the screen uses for it.
export function sourceLabel(source) {
  if (source === 'balance') return 'Taken from his balance';
  if (source === 'cash') return 'Paid in cash / M-Pesa';
  if (source === 'contribution') return 'Out of a contribution';
  return 'Recorded earlier — not yet checked';
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
