const { toEatDateString } = require('./weekCycle');

// Whether a date is later than today, on the group's own calendar.
//
// Every form that takes a payment date refuses one in the future (a mistyped year would put money
// in a week that has not happened). The check used to compare against the *server's* end of day,
// and the server keeps UTC while the group keeps East Africa Time, three hours ahead. So between
// midnight and 3am a treasurer picking today's date — a date the screen itself offers — was told
// it was in the future. Comparing the two as calendar days in EAT removes the window.
function isAfterToday(value, now = Date.now()) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return false;
  return toEatDateString(at) > toEatDateString(new Date(now));
}

module.exports = { isAfterToday };
