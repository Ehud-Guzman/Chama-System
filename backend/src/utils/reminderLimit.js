// Who the group stops chasing: a member holding at least this much is not told he is behind.
//
// The problem this answers is the one the treasurer sees first. A member who brought a hundred
// thousand shillings into the cycle and then missed a Thursday is *behind* by the engine's own
// count — one closed week, 1,400 — and a reminders screen that only reads the week-by-week
// schedule will email him about it. He is not behind in any sense the group means: he has paid
// more into this cycle than the cycle has asked of him so far. Emailing him is how a chama teaches
// its best-paying members to stop reading its emails.
//
// So the line is drawn in money, and it is a line the group draws rather than one this file
// decides:
//
//   Settings.reminderMoneyLimit      the figure, measured in the week the books opened — the
//                                    treasurer's own number (114,600 for week 92 here)
//   Settings.reminderMoneyLimitWeek  the week that figure belongs to; null means the cycle's own
//                                    opening week, so a fresh install needs only one number
//
// and the line **moves with the cycle**: `limit(week) = base + weeklyAmount × (week − anchor)`.
// Week 92 therefore reads 114,600, week 93 reads 116,000, week 94 reads 117,400 — the same 1,400
// a week the collection itself moves by, because the figure it is being compared against is what
// the group expects a member to have put in by then. Without that growth the rule would silently
// expire: a fixed 114,600 stops excluding anybody a fortnight later.
//
// `reminderMoneyLimit = 0` switches the whole thing off, and that is a real choice rather than a
// degenerate case: the group that wants every member who is behind told about it, whatever he
// holds, sets zero and gets the behaviour this system had before the field existed.
//
// What the limit does NOT touch:
//   - his passbook. His own page still reports the week he missed, because that is his record.
//   - his fines. A fine is something he was charged for breaking a rule; having money in hand is
//     not a defence, and the fine emails were never part of this budget (utils/reminderLog).
//   - the books. Nothing here changes a figure anywhere: it decides who is written to.
//
// The comparison is made against `ledger.money` — the money the group is actually holding for him
// (carried in + paid in − tea). Not against what he was asked for and not against his arrears: the
// question is "does he have money in the group's hands", and this is the engine's own answer to it.
const { toMoney } = require('./money');

// The group's own line as at its opening week. 1,400 × 82 weeks less 200 that the paper ledger had
// already carried into the 92nd week's figure — the treasurer's number, not a derived one, which is
// why it lives in Settings where it can be corrected rather than in a formula.
const DEFAULT_MONEY_LIMIT = 114600;

// A ceiling rather than a free number, the same idea as the weekly reminder cap: an office typing
// 114600000 should be told, not obeyed — a limit above every member's balance switches the rule off
// silently, which is the opposite of what somebody typing it meant.
const MONEY_LIMIT_CEILING = 10000000;

// The stored value, coerced rather than trusted. A settings document can be posted to, and a
// string, a fraction or a negative would otherwise produce a line nobody can reason about:
// `'114600' >= 114600` is false in JavaScript for a *string* on the left, which would quietly stop
// excluding the members the treasurer meant to exclude. The money formats the ledger screen already
// accepts are read here too — "1,400", "Ksh 114600" — because the same person types into both
// (see ledgerController.readAmount). Blank means "the default", never zero: a box merely tabbed
// through must not switch the rule off.
function normaliseMoneyLimit(value) {
  if (value === undefined || value === null) return DEFAULT_MONEY_LIMIT;
  const text = String(value).trim().replace(/^ksh/i, '').replace(/[\s,\u00a0]/g, '');
  if (text === '') return DEFAULT_MONEY_LIMIT;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) return DEFAULT_MONEY_LIMIT;
  return Math.min(MONEY_LIMIT_CEILING, Math.round(amount));
}

// The week the figure was measured in. Blank and null both mean "the week the books opened", which
// is what a group that has only ever typed one number gets.
function normaliseMoneyLimitWeek(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const week = Number(value);
  if (!Number.isInteger(week) || week < 1) return null;
  return week;
}

// The line as it stands in `currentWeek`, or 0 when the rule is switched off. Pure, so the
// reminders screen, the weekly sweep and the sweep's own report all read it the same way.
function moneyLimitForWeek(settings, config, currentWeek) {
  const base = normaliseMoneyLimit(settings?.reminderMoneyLimit);
  if (base <= 0) return 0;

  const anchor = normaliseMoneyLimitWeek(settings?.reminderMoneyLimitWeek) ?? config.cycleStartWeek;
  // Nothing is added for a week the group has not reached, so a limit anchored in a future week
  // reads as the figure itself rather than as the figure minus a few weeks' worth.
  const weeksSince = Math.max(0, (Number(currentWeek) || 0) - anchor);
  return toMoney(base + (Number(config.weeklyAmount) || 0) * weeksSince);
}

// The decision, as a pure function of (what he holds, where the line is). At or above the line he
// is not chased; strictly below it he is. A limit of 0 never covers anybody, which is what makes
// zero the off switch.
function coveredByBalance(moneyHeld, limit) {
  const line = Number(limit) || 0;
  if (line <= 0) return false;
  return (Number(moneyHeld) || 0) >= line;
}

const money = (n) => 'Ksh ' + Number(n || 0).toLocaleString('en-KE');

// Why a member was left out, in the words the office needs — because the alternative is a
// treasurer who can see the week he missed and cannot see why nobody was emailed about it.
function aboveLimitReason({ moneyHeld, limit, weekNumber }) {
  return (
    `Holds ${money(moneyHeld)}, at or above the ${money(limit)} the group stops chasing in `
    + `week ${weekNumber} — not told he is behind (Settings → Reminders).`
  );
}

module.exports = {
  DEFAULT_MONEY_LIMIT,
  MONEY_LIMIT_CEILING,
  normaliseMoneyLimit,
  normaliseMoneyLimitWeek,
  moneyLimitForWeek,
  coveredByBalance,
  aboveLimitReason,
};
