// Money arithmetic for a ledger, in one place.
//
// Every amount in this system is Kenyan shillings, and in practice they are whole
// shillings: 1,400 a week, 100 of tea, 50 fines. They are stored as JavaScript
// numbers, which are IEEE-754 doubles — so 0.1 + 0.2 is not 0.3, and a figure that
// has been through a division can arrive a hair under what it should be. That is
// how a settled member ends up with an arrears of -1.4e-14 and a `> 0` check marks
// him as behind.
//
// Two rules, applied everywhere money is written:
//
//   1. Round to two decimal places at the boundary, before storage. That keeps
//      every stored amount a value a person could have typed.
//   2. Reject the absurd. A number that is not finite, is negative, or is past
//      MAX_AMOUNT is a bug or an attack, not a payment.
//
// Two decimal places rather than whole shillings on purpose: the group collects
// whole shillings today, and rounding to whole shillings would silently alter a
// figure somebody did type with cents on it. Rounding to the smallest unit the UI
// can display is the conservative choice.
const MAX_AMOUNT = 1_000_000_000; // Ksh 1bn — well past anything this chama holds

// Two decimal places, as a number. `Math.round(x * 100) / 100` rather than
// `toFixed(2)` because toFixed returns a string and re-parses to the same float,
// while this lands on the nearest representable double to the 2-dp value.
function toMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n * 100) / 100;
  // Normalise negative zero: -0 is a legal Number and an ugly thing to store, and
  // it makes `Object.is` comparisons (and the test suite) disagree with `===`.
  return rounded === 0 ? 0 : rounded;
}

// Validation for an amount arriving from a client. `{ value }` when usable,
// `{ error }` when not — the shape the controllers already speak.
function readMoney(value, { min = 0, max = MAX_AMOUNT, label = 'Amount' } = {}) {
  if (value === undefined || value === null || value === '') return { error: `${label} is required` };
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: `${label} must be a number` };
  if (n < min) return { error: `${label} cannot be less than ${min}` };
  if (n > max) return { error: `${label} is unrealistically large` };
  return { value: toMoney(n) };
}

// A mongoose setter for a money field: every write through the model is rounded,
// whichever controller or script made it. Defence in depth — the controllers round
// too, so a future code path that forgets cannot introduce drift.
function moneySetter(value) {
  if (value === null || value === undefined || value === '') return value;
  return toMoney(value);
}

// Shared limits, so a schema validator and a controller message agree.
const MONEY_MAX = [MAX_AMOUNT, 'Amount is unrealistically large'];
const MONEY_MIN = [0, 'Amount cannot be negative'];

module.exports = { toMoney, readMoney, moneySetter, MAX_AMOUNT, MONEY_MAX, MONEY_MIN };
