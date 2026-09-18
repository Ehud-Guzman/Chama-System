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

// There is only ever one Settings document, created with defaults on first read.
//
// The week anchor is pinned here — once, on the first read — rather than being
// derived from the clock every time. A derived anchor would always describe "the
// current week" as the opening week, so the week number would never advance;
// pinning it means week 92 really is the week the system went live and week 93
// starts on its own the following Friday, same as the old per-member schedule
// advanced without anyone pressing anything.
//
// The document is identified by `key: 'main'` now rather than by "the only row
// there is": two concurrent first requests (or two instances during a deploy)
// could each create a row, and then the figures every balance is computed from
// would depend on which row answered.
async function getOrCreateSettings({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;

  let settings = await Settings.findOne({ key: 'main' });

  if (!settings) {
    // A database that predates the key: adopt its row instead of adding a second.
    const legacy = await Settings.findOne({
      $or: [{ key: { $exists: false } }, { key: null }, { key: '' }],
    }).sort({ createdAt: 1 });
    if (legacy) {
      legacy.key = 'main';
      try {
        await legacy.save();
        settings = legacy;
      } catch (err) {
        // Another instance adopted it first, or a row now exists with the key.
        settings = err.code === 11000 ? await Settings.findOne({ key: 'main' }) : null;
        if (!settings) throw err;
      }
    }
  }

  if (!settings) {
    try {
      settings = await Settings.create({ key: 'main' });
    } catch (err) {
      // Lost the race to create it: read the winner's row.
      if (err.code === 11000) settings = await Settings.findOne({ key: 'main' });
      else throw err;
    }
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

