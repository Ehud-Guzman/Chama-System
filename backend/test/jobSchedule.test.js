// The schedule arithmetic, pinned to EAT.
//
// These are the numbers behind "a backup nobody has to remember to take". Getting them
// wrong is quiet and expensive in the same way the week engine's errors are: a schedule
// that drifts by three hours runs the backup in the middle of the morning's collections,
// and one that drifts a day silently skips a night.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseSchedule,
  nextRunAt,
  describeGap,
  eatParts,
  fromEatParts,
} = require('../src/utils/jobSchedule');

// 2026-01-02 is a Friday. Building instants through fromEatParts keeps the test readable
// and keeps the arithmetic under test out of the test's own fixture code.
const EAT = (year, month, day, hour = 0, minute = 0) =>
  fromEatParts({ year, month: month - 1, day, hour, minute });

test('EAT is a fixed +3 offset', () => {
  // 03:00 in Nairobi is 00:00 UTC. If this ever changes, every schedule in the system moves.
  assert.equal(EAT(2026, 1, 2, 3, 0), Date.UTC(2026, 0, 2, 0, 0));
  assert.deepEqual(eatParts(EAT(2026, 1, 2, 3, 30)), {
    year: 2026,
    month: 0,
    day: 2,
    weekday: 5, // Friday
    hour: 3,
    minute: 30,
  });
});

test('a daily schedule runs later today, or tomorrow once today has passed', () => {
  const schedule = parseSchedule('daily@03:00');
  assert.equal(nextRunAt(schedule, EAT(2026, 1, 2, 1, 0)), EAT(2026, 1, 2, 3, 0));
  assert.equal(nextRunAt(schedule, EAT(2026, 1, 2, 4, 0)), EAT(2026, 1, 3, 3, 0));
});

test('a schedule that fires exactly now moves on rather than repeating', () => {
  // The job asks "when next" from inside its own run. Answering "now" would spin.
  const schedule = parseSchedule('daily@03:00');
  assert.equal(nextRunAt(schedule, EAT(2026, 1, 2, 3, 0)), EAT(2026, 1, 3, 3, 0));
});

test('a daily schedule lands at the same wall-clock time every day', () => {
  const schedule = parseSchedule('daily@02:30');
  let at = EAT(2026, 1, 1, 12, 0);
  for (let day = 2; day <= 5; day += 1) {
    const next = nextRunAt(schedule, at);
    const parts = eatParts(next);
    assert.equal(parts.hour, 2);
    assert.equal(parts.minute, 30);
    at = next;
  }
  assert.equal(at, EAT(2026, 1, 5, 2, 30));
});

test('a weekly schedule finds the next occurrence of its weekday', () => {
  // Fridays: 2026-01-02, 09, 16.
  const schedule = parseSchedule('weekly@fri@03:00');
  // From Thursday, it is tomorrow.
  assert.equal(nextRunAt(schedule, EAT(2026, 1, 1, 10, 0)), EAT(2026, 1, 2, 3, 0));
  // From Friday before the time, it is today.
  assert.equal(nextRunAt(schedule, EAT(2026, 1, 2, 1, 0)), EAT(2026, 1, 2, 3, 0));
  // From Friday after the time, it is a week away.
  assert.equal(nextRunAt(schedule, EAT(2026, 1, 2, 4, 0)), EAT(2026, 1, 9, 3, 0));
  // From Saturday, it is six days away.
  assert.equal(nextRunAt(schedule, EAT(2026, 1, 3, 9, 0)), EAT(2026, 1, 9, 3, 0));
});

test('a monthly schedule rolls into the next month once the day has passed', () => {
  const firstOfMonth = parseSchedule('monthly@1@04:00');
  assert.equal(nextRunAt(firstOfMonth, EAT(2026, 1, 15, 12, 0)), EAT(2026, 2, 1, 4, 0));
  assert.equal(nextRunAt(firstOfMonth, EAT(2026, 1, 1, 5, 0)), EAT(2026, 2, 1, 4, 0));
  assert.equal(nextRunAt(firstOfMonth, EAT(2026, 1, 1, 3, 0)), EAT(2026, 1, 1, 4, 0));
});

test('a month without the requested day uses its last day instead of skipping', () => {
  // "Monthly on the 31st" means the end of the month, not ten runs a year.
  const endOfMonth = parseSchedule('monthly@31@02:00');
  // 2026 is not a leap year, so February ends on the 28th.
  assert.equal(nextRunAt(endOfMonth, EAT(2026, 2, 1, 0, 0)), EAT(2026, 2, 28, 2, 0));
  // And a 30-day month ends on the 30th.
  assert.equal(nextRunAt(endOfMonth, EAT(2026, 4, 1, 0, 0)), EAT(2026, 4, 30, 2, 0));
  // A 31-day month gets the 31st.
  assert.equal(nextRunAt(endOfMonth, EAT(2026, 1, 1, 0, 0)), EAT(2026, 1, 31, 2, 0));
});

test('a parsed schedule defaults to 03:00 EAT when no time is given', () => {
  const daily = parseSchedule('daily');
  assert.equal(daily.hour, 3);
  assert.equal(daily.minute, 0);
  assert.equal(nextRunAt(daily, EAT(2026, 1, 2, 1, 0)), EAT(2026, 1, 2, 3, 0));
});

test('a schedule that cannot be understood says so, and says what is allowed', () => {
  for (const bad of ['', 'hourly', 'daily@25:00', 'daily@3:5', 'weekly@xyz@03:00', 'monthly@0@01:00', 'monthly@32@01:00']) {
    assert.throws(() => parseSchedule(bad), /not a |is not a/, `expected "${bad}" to be refused`);
  }
  // The message has to be usable: this is what an operator sees when a deploy is misconfigured.
  assert.throws(() => parseSchedule('hourly'), /daily@HH:MM/);
});

test('the gap is described the way a person would say it', () => {
  assert.equal(describeGap(0), '0m');
  assert.equal(describeGap(90 * 1000), '2m'); // rounds to the nearest minute
  assert.equal(describeGap(3 * 3600 * 1000 + 20 * 60 * 1000), '3h 20m');
  assert.equal(describeGap(26 * 3600 * 1000), '1d 2h');
  assert.equal(describeGap(-5000), '0m'); // a job that is overdue reads as due, never as negative
});
