// When a scheduled job runs next.
//
// Everything in this system happens because somebody pressed something. That is the right
// default for the books — no deploy should ever change a figure on its own — but it is the
// wrong default for two things: a backup that nobody remembers to take, and a trail that
// nobody remembers to check. This module is the arithmetic behind those, and it is a pure
// function of (schedule, now) so it can be tested without waiting for Friday.
//
// Times are pinned to East African time, a fixed +3 with no daylight saving, for the same
// reason the week cycle is (utils/weekCycle): the API runs on hosts that default to UTC
// while the committee's phones are on EAT, and "3am" has to mean 3am in the office. A
// nightly backup that actually runs at 6am because nobody adjusted for the offset is a
// backup that runs in the middle of the morning's collections.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// The wall clock in EAT, as a set of plain numbers. Read through the UTC getters on a
// shifted instant, which is only confusing until you notice there is no timezone library
// involved and there could not be a simpler correct answer: EAT never changes.
function eatParts(atMs) {
  const shifted = new Date(atMs + EAT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

// The instant an EAT wall-clock time falls on.
function fromEatParts({ year, month, day, hour, minute }) {
  return Date.UTC(year, month, day, hour, minute, 0, 0) - EAT_OFFSET_MS;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addDays(parts, count) {
  const shifted = new Date(Date.UTC(parts.year, parts.month, parts.day + count));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: parts.hour,
    minute: parts.minute,
  };
}

const SCHEDULE_HELP =
  'Use "daily@HH:MM", "weekly@<weekday>@HH:MM" (e.g. weekly@fri@03:00), or "monthly@<day>@HH:MM".';

// Parses a schedule written the way a person would say it. A string, because it lives in
// an environment variable, and a nested options object in .env is not a thing.
function parseSchedule(value) {
  const text = String(value || '').trim().toLowerCase();
  const parts = text.split('@').map((piece) => piece.trim());
  const kind = parts[0];

  function timeOf(piece, fallback) {
    if (!piece) return fallback;
    const match = /^(\d{1,2}):(\d{2})$/.exec(piece);
    if (!match) throw new Error(`"${piece}" is not a time. ${SCHEDULE_HELP}`);
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) throw new Error(`"${piece}" is not a valid time. ${SCHEDULE_HELP}`);
    return { hour, minute };
  }

  if (kind === 'daily') {
    return { kind, ...timeOf(parts[1], { hour: 3, minute: 0 }), text };
  }

  if (kind === 'weekly') {
    const weekday = WEEKDAY_NAMES.indexOf(parts[1]);
    if (weekday === -1) throw new Error(`"${parts[1]}" is not a weekday. ${SCHEDULE_HELP}`);
    return { kind, weekday, ...timeOf(parts[2], { hour: 3, minute: 0 }), text };
  }

  if (kind === 'monthly') {
    const day = Number(parts[1]);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error(`"${parts[1]}" is not a day of the month. ${SCHEDULE_HELP}`);
    }
    return { kind, day, ...timeOf(parts[2], { hour: 3, minute: 0 }), text };
  }

  throw new Error(`"${text}" is not a schedule. ${SCHEDULE_HELP}`);
}

// The next instant this schedule fires strictly after `fromMs`.
//
// Strictly after, not on: a job that fires at its scheduled second and then asks "when
// next" must not be told "now", or it runs in a tight loop.
function nextRunAt(schedule, fromMs = Date.now()) {
  const now = eatParts(fromMs);

  if (schedule.kind === 'daily') {
    // Today at the given time if that is still ahead, otherwise tomorrow.
    for (const offset of [0, 1]) {
      const day = addDays(now, offset);
      const candidate = fromEatParts({ ...day, hour: schedule.hour, minute: schedule.minute });
      if (candidate > fromMs) return candidate;
    }
  }

  if (schedule.kind === 'weekly') {
    // The next occurrence of the weekday — this week's if it is still ahead, else next
    // week's. Eight steps covers a full cycle even when today is the day.
    for (let offset = 0; offset <= 7; offset += 1) {
      const day = addDays(now, offset);
      if (day.weekday !== schedule.weekday) continue;
      const candidate = fromEatParts({ ...day, hour: schedule.hour, minute: schedule.minute });
      if (candidate > fromMs) return candidate;
    }
  }

  if (schedule.kind === 'monthly') {
    for (const monthOffset of [0, 1, 2]) {
      const anchor = new Date(Date.UTC(now.year, now.month + monthOffset, 1));
      const year = anchor.getUTCFullYear();
      const month = anchor.getUTCMonth();
      // A month with no 31st runs the job on its last day rather than skipping it: the
      // point of "monthly on the 31st" is "at the end of the month", and silently skipping
      // February is how a monthly backup becomes ten backups a year.
      const day = Math.min(schedule.day, daysInMonth(year, month));
      const candidate = fromEatParts({ year, month, day, hour: schedule.hour, minute: schedule.minute });
      if (candidate > fromMs) return candidate;
    }
  }

  throw new Error(`"${schedule.text || JSON.stringify(schedule)}" has no next run`);
}

// "in 3h 20m", for a log line and the settings screen.
function describeGap(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const pieces = [];
  if (days) pieces.push(`${days}d`);
  if (hours) pieces.push(`${hours}h`);
  if (minutes || pieces.length === 0) pieces.push(`${minutes}m`);
  return pieces.join(' ');
}

module.exports = {
  EAT_OFFSET_MS,
  WEEKDAY_NAMES,
  parseSchedule,
  nextRunAt,
  describeGap,
  eatParts,
  fromEatParts,
  SCHEDULE_HELP,
};
