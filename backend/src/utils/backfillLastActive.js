const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

// Gives every account that has done something the time it last did it.
//
// "Last seen" (User.lastActiveAt) is only recorded from the release that introduced the Control
// Room, so an account that was in daily use before it reads as "no sign-in recorded". The audit
// trail already knows better: every create, edit and delete carries who did it and when. The newest
// entry by an account is a true lower bound on when it was last used — it is never later than
// reality, and it is never invented for an account that has never written anything.
//
// Safe to run any number of times: it only fills a missing time, never moves one that is there, and
// `timestamps: false` so filling it does not count as an edit of the account.
async function backfillLastActive({ dryRun = false } = {}) {
  const missing = await User.find({ $or: [{ lastActiveAt: null }, { lastActiveAt: { $exists: false } }] })
    .select('name')
    .lean();

  const filled = [];
  for (const user of missing) {
    const entry = await AuditLog.findOne({ performedBy: user._id }).sort({ createdAt: -1 }).select('createdAt').lean();
    if (!entry?.createdAt) continue;
    if (!dryRun) {
      await User.updateOne({ _id: user._id }, { $set: { lastActiveAt: entry.createdAt } }, { timestamps: false });
    }
    filled.push({ id: user._id, name: user.name, at: entry.createdAt });
  }
  return { checked: missing.length, filled };
}

module.exports = { backfillLastActive };
