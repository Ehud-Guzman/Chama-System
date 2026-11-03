// The weekly contribution by week.
//
// The weekly contribution is not one number for all time. The group raises it from a given week, and a rise
// applies from that week onward: every week before it keeps the amount it was asked for, so what a member paid
// in full in week 99 is still paid in full in week 99 after a rise at week 103. Settings holds the amount the
// cycle opened with (`weeklyAmount`) and the dated rises (`weeklyAmountChanges`: [{ fromWeek, amount }]).
//
// No requires on purpose: weekCycle and reminderLimit both need these, and weekCycle already requires
// reminderLimit, so anything either of them imported from the other would be a cycle.
//
// Every helper also works on a plain `{ cycleStartWeek, weeklyAmount }` with no changes, as the tests build
// them, where the amount is simply the same every week.

// The rises as a clean ascending list: a whole week number and a positive amount each, the last entry for a
// week winning if two name the same one.
function normaliseWeeklyChanges(list) {
  if (!Array.isArray(list)) return [];
  const byWeek = new Map();
  for (const entry of list) {
    const fromWeek = Number(entry && entry.fromWeek);
    const amount = Number(entry && entry.amount);
    if (!Number.isInteger(fromWeek) || fromWeek < 1 || !Number.isFinite(amount) || amount <= 0) continue;
    byWeek.set(fromWeek, { fromWeek, amount });
  }
  return [...byWeek.values()].sort((a, b) => a.fromWeek - b.fromWeek);
}

// What the weekly contribution asks of a member in the given week.
function weeklyAmountForWeek(config, weekNumber) {
  let amount = Number(config.weeklyBase ?? config.weeklyAmount) || 0;
  for (const change of config.weeklyChanges || []) {
    if (change.fromWeek <= weekNumber) amount = change.amount;
  }
  return amount;
}

// The weekly amounts of weeks fromWeek..toWeek added up (both included; nothing when the range is empty).
function sumWeeklyAmounts(config, fromWeek, toWeek) {
  let total = 0;
  for (let w = fromWeek; w <= toWeek; w++) total += weeklyAmountForWeek(config, w);
  return total;
}

module.exports = { normaliseWeeklyChanges, weeklyAmountForWeek, sumWeeklyAmounts };
