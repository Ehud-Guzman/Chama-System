const Settings = require('../models/Settings');
const {
  fridayOf,
  DEFAULT_CYCLE_START_WEEK,
  DEFAULT_WEEKLY_AMOUNT,
  DEFAULT_CHAI_AMOUNT,
} = require('./weekCycle');

// There is only ever one Settings document. Create it with defaults on first read.
//
// The week anchor is pinned here — once, on the first read — rather than being
// derived from the clock every time. A derived anchor would always describe "the
// current week" as the opening week, so the week number would never advance;
// pinning it means week 92 really is the week the system went live and week 93
// starts on its own the following Friday, same as the old per-member schedule
// advanced without anyone pressing anything.
async function getOrCreateSettings() {
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
  return settings;
}

module.exports = { getOrCreateSettings };
