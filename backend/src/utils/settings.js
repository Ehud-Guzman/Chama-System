const Settings = require('../models/Settings');
const {
  fridayOf,
  DEFAULT_CYCLE_START_WEEK,
  DEFAULT_WEEKLY_AMOUNT,
  DEFAULT_CHAI_AMOUNT,
} = require('./weekCycle');

// A round trip to the database costs real time — on the hosted app it is tens of
// milliseconds, on a poor link it is a good fraction of a second — and almost
// every request needs Settings. One in-process copy, refreshed on a short timer,
// takes that round trip off every page load; the write paths call
// invalidateSettings() so a change is never served stale for longer than the
// request that made it.
const CACHE_MS = 30 * 1000;
let cached = null;
let cachedAt = 0;

function invalidateSettings() {
  cached = null;
  cachedAt = 0;
}

// There is only ever one Settings document. Create it with defaults on first read.
//
// The week anchor is pinned here — once, on the first read — rather than being
// derived from the clock every time. A derived anchor would always describe "the
// current week" as the opening week, so the week number would never advance;
// pinning it means week 92 really is the week the system went live and week 93
// starts on its own the following Friday, same as the old per-member schedule
// advanced without anyone pressing anything.
async function getOrCreateSettings({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;

  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({});
  }
  if (!settings.weekAnchorDate) {
    settings = await Settings.findByIdAndUpdate(
      settings._id,
      {
        $set: {
          weekAnchorDate: fridayOf(new Date()),
          cycleStartWeek: settings.cycleStartWeek || DEFAULT_CYCLE_START_WEEK,
          weeklyAmount: settings.weeklyAmount ?? DEFAULT_WEEKLY_AMOUNT,
          chaiAmount: settings.chaiAmount ?? DEFAULT_CHAI_AMOUNT,
        },
      },
      { new: true }
    );
  }
  cached = settings;
  cachedAt = Date.now();
  return settings;
}

module.exports = { getOrCreateSettings, invalidateSettings };

