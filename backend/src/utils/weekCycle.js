// The group's contribution week engine.
//
// The cycle is anchored chama-wide rather than per member: the paper ledger the
// group kept before this system ran one row per week for everybody, so everyone
// shares a week number at any moment. `cycleStartWeek` is the number the anchor
// date belongs to (92 when the system went live), which means the number shown
// and the amount required roll forward on their own every week — no admin ever
// has to "start" a new week.
//
// Constitution §7.4: the contribution week runs Friday → Thursday and closes on
// the Thursday, so every range below starts on a Friday and ends on a Thursday.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Kenya runs a fixed +3 with no daylight saving, so a week boundary is plain
// arithmetic rather than a timezone-database lookup. Fixing the offset matters
// for more than tidiness: the API runs on hosts that default to UTC while the
// treasurer's phone is on EAT, and without it a payment made at 00:30 Friday
// would be booked to the week that had just closed.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

// Fallbacks for a database whose Settings document predates the cycle fields.
// 1,400 and 100 are the amounts written into the constitution (§7.1, §7.2).
const DEFAULT_CYCLE_START_WEEK = 92;
const DEFAULT_WEEKLY_AMOUNT = 1400;
const DEFAULT_CHAI_AMOUNT = 100;

// Midnight EAT of the day containing `value`, as an instant.
function startOfDay(value) {
  const ms = new Date(value).getTime();
  return Math.floor((ms + EAT_OFFSET_MS) / DAY_MS) * DAY_MS - EAT_OFFSET_MS;
}

// The EAT calendar date of `value` — 'YYYY-MM-DD'. Used wherever a date has to
// cross to a client intact: an ISO instant would render as the previous day in
// a UTC browser, and reading only its first ten characters back would move the
// anchor a week earlier.
function toEatDateString(value) {
  return new Date(new Date(value).getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

// The inverse: an EAT calendar date (or any date input value) as the instant
// midnight EAT on that day. A bare 'YYYY-MM-DD' is read as an EAT date, not a
// UTC one, which is what makes a round trip through the setup form lossless.
function parseEatDate(input) {
  const text = String(input || '').trim();
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (bare) {
    return new Date(Date.UTC(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) - EAT_OFFSET_MS);
  }
  return new Date(startOfDay(text));
}

// Friday 00:00 EAT of the Friday→Thursday week containing `date`.
function fridayOf(date) {
  const dayStart = startOfDay(date);
  // Read the weekday back in EAT, not the server's zone.
  const weekday = new Date(dayStart + EAT_OFFSET_MS).getUTCDay(); // 0 = Sunday … 6 = Saturday
  const back = (weekday - 5 + 7) % 7; // days back to the Friday on or before that day
  return new Date(dayStart - back * DAY_MS);
}

// Everything downstream reads the cycle through this shape, so the amounts can
// be changed by resolution without touching the anchor — moving the anchor would
// silently renumber every week already logged.
function resolveConfig(settings) {
  if (!settings || !settings.weekAnchorDate) {
    throw new Error('Week cycle anchor is not set — call getOrCreateSettings() first');
  }
  return {
    cycleStartWeek: Number(settings.cycleStartWeek) || DEFAULT_CYCLE_START_WEEK,
    weeklyAmount: Number.isFinite(Number(settings.weeklyAmount))
      ? Number(settings.weeklyAmount)
      : DEFAULT_WEEKLY_AMOUNT,
    chaiAmount: Number.isFinite(Number(settings.chaiAmount))
      ? Number(settings.chaiAmount)
      : DEFAULT_CHAI_AMOUNT,
    anchorDate: new Date(settings.weekAnchorDate),
    anchorMs: new Date(settings.weekAnchorDate).getTime(),
  };
}

// Raw week number for a date — may fall before the cycle (historical rows) or
// after today (a backdated-then-forward edit), so callers that only care about
// the live cycle should use cycleWeekNumber(). Both ends are EAT midnights, so
// the delta is always an exact multiple of a week and no rounding drifts.
function weekNumberForDate(date, config) {
  const offset = Math.floor((startOfDay(date) - config.anchorMs) / WEEK_MS);
  return config.cycleStartWeek + offset;
}

// Week number clamped into the live cycle. A payment dated before the anchor is
// credited to the opening week rather than to a phantom week the ledger has no
// row for, so no amount can ever fall out of the week-by-week figures.
function cycleWeekNumber(date, config) {
  return Math.max(config.cycleStartWeek, weekNumberForDate(date, config));
}

function weekRange(weekNumber, config) {
  const start = new Date(config.anchorMs + (weekNumber - config.cycleStartWeek) * WEEK_MS);
  return {
    weekNumber,
    startDate: start,
    endDate: new Date(start.getTime() + WEEK_MS - 1),
  };
}

// The week the group is in right now. Never returns less than the opening week,
// so a server clock set before the anchor can't produce a negative cycle.
function currentWeekNumber(config, now = Date.now()) {
  return Math.max(config.cycleStartWeek, weekNumberForDate(now, config));
}

// How many weeks of the cycle have come up so far — week 92 itself counts as
// one, which is what makes the requirement 1,400 in week 92 and 2,800 in 93.
function weeksElapsed(config, now = Date.now()) {
  return currentWeekNumber(config, now) - config.cycleStartWeek + 1;
}

// The scored weeks that have *closed* — the ones that carry an expectation right
// now. The week running today is not one of them: its Thursday is still to come,
// and 1,400 plus the tea are counted for a week the day after it closes.
//
// This is what keeps the figures a go-live is set up with exactly as the
// treasurer keyed them. Those totals are the members' money as at the last
// Thursday; the money for the week now running is collected on the coming
// Thursday and counted from the day after, so the ledger's expectations and the
// group's collections move together instead of the ledger billing a week nobody
// has been asked for yet. Open the books on a Friday and nothing is due; by the
// following Friday one week is, and the collection that closed it is already in.
function scoredWeeks(config, now = Date.now()) {
  return Math.max(0, currentWeekNumber(config, now) - 1 - config.cycleStartWeek);
}

// Every week number the group has ever had, back to week 1, for the weeks
// *before* the one this ledger scores. They exist so the numbering reads exactly
// as the paper ledger did — each week closing on its Thursday, all the way back
// to the first — while only the weeks from cycleStartWeek onward carry an
// expectation: the money for the earlier ones is already inside each member's
// carried-forward balance, so scoring them again would bill the same weeks twice.
function cycleHistory(config) {
  const weeks = [];
  for (let w = 1; w < config.cycleStartWeek; w++) {
    weeks.push({ ...weekRange(w, config), isHistory: true });
  }
  return weeks;
}

module.exports = {
  WEEK_MS,
  DAY_MS,
  EAT_OFFSET_MS,
  DEFAULT_CYCLE_START_WEEK,
  DEFAULT_WEEKLY_AMOUNT,
  DEFAULT_CHAI_AMOUNT,
  fridayOf,
  toEatDateString,
  parseEatDate,
  resolveConfig,
  weekNumberForDate,
  cycleWeekNumber,
  weekRange,
  currentWeekNumber,
  weeksElapsed,
  scoredWeeks,
  cycleHistory,
};
