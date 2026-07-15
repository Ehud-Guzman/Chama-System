const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Builds a week-by-week due schedule anchored to the member's own join date,
// from week 1 through the current week. Each week is judged independently
// against the type's fixed weeklyAmount — no rollover between weeks.
function buildWeeklySchedule(joinDate, weeklyAmount, contributions) {
  const start = new Date(joinDate).getTime();
  const now = Date.now();
  const weekCount = Math.max(1, Math.floor((now - start) / WEEK_MS) + 1);

  const weeks = [];
  for (let i = 0; i < weekCount; i++) {
    const startDate = new Date(start + i * WEEK_MS);
    const endDate = new Date(start + (i + 1) * WEEK_MS - 1);
    // Use what the member actually handed over (grossAmount), not the net
    // amount credited to this type — a payment that was partly redirected to
    // settle a fine still fulfilled this week's due from the member's side.
    const paid = contributions
      .filter((c) => {
        const t = new Date(c.date).getTime();
        return t >= startDate.getTime() && t <= endDate.getTime();
      })
      .reduce((sum, c) => sum + (c.grossAmount || c.amount), 0);

    let status = 'unpaid';
    if (paid >= weeklyAmount && weeklyAmount > 0) status = 'paid';
    else if (paid > 0) status = 'partial';

    weeks.push({ weekNumber: i + 1, startDate, endDate, expected: weeklyAmount, paid, status });
  }
  return weeks;
}

module.exports = { buildWeeklySchedule };
