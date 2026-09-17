const { currentWeekNumber, weekRange, cycleWeekNumber } = require('./weekCycle');

// Week-by-week due schedule for one fixed weekly amount.
//
// Taken from the group cycle — week 92 closing on its Thursday and advancing by
// itself every Friday — rather than from each member's own join date. Anchoring
// on joinDate was right while every member's history was imported week by week,
// but after the Week-92 reset it would show each member 60-odd weeks of
// "unpaid" that the house never expected of him. Every member is on the same
// week number as everyone else, and the schedule only reaches back as far as
// the cycle does.
//
// `contributions` are this member's rows for the same fund only. grossAmount is
// used when present so a payment partly redirected to settle a fine still
// fulfilled the week from the member's own side.
function buildWeeklySchedule(config, weeklyAmount, contributions) {
  const currentWeek = currentWeekNumber(config);

  const paidByWeek = new Map();
  for (const c of contributions) {
    const week = cycleWeekNumber(c.date, config);
    const cash = Number(c.grossAmount ?? c.amount) || 0;
    paidByWeek.set(week, (paidByWeek.get(week) || 0) + cash);
  }

  const weeks = [];
  for (let w = config.cycleStartWeek; w <= currentWeek; w++) {
    const paid = paidByWeek.get(w) || 0;
    let status = 'unpaid';
    if (weeklyAmount > 0 && paid >= weeklyAmount) status = 'paid';
    else if (paid > 0) status = 'partial';

    // isCurrent marks the week still running, so the UI can separate it from
    // settled history — a week in progress is never "not paid yet".
    weeks.push({
      ...weekRange(w, config),
      expected: weeklyAmount,
      paid,
      status,
      isCurrent: w === currentWeek,
    });
  }
  return weeks;
}

module.exports = { buildWeeklySchedule };
