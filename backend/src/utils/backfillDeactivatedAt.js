const Member = require('../models/Member');
const AuditLog = require('../models/AuditLog');

// Gives every member who is already inactive the day he was made inactive.
//
// A member's accounting ends on that day (utils/membership), and the day is only recorded from the
// release that introduced it. For everybody made inactive before it, the exact day is still known: the
// audit trail wrote an entry when his record changed from active to inactive. So it is read from there,
// and failing that from his resignation date, and failing that from the last time his record changed
// (the same fallback the ledger uses, now written down so that it stops moving when somebody edits him).
//
// Safe to run any number of times: it only ever fills a date that is missing, never changes one that is
// there, and writes nothing else. `timestamps: false` so that filling the date does not itself count as
// an edit of his record and move the fallback it replaces.
async function backfillDeactivatedAt({ dryRun = false } = {}) {
  const missing = await Member.find({
    active: false,
    $or: [{ deactivatedAt: null }, { deactivatedAt: { $exists: false } }],
  })
    .select('name resignedAt updatedAt')
    .lean();

  const filled = [];
  for (const member of missing) {
    const entry = await AuditLog.findOne({
      entityType: 'Member',
      entityId: member._id,
      'after.active': false,
      'before.active': { $ne: false },
    })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();

    let at = null;
    let from = null;
    if (entry?.createdAt) {
      at = entry.createdAt;
      from = 'audit trail';
    } else if (member.resignedAt) {
      at = member.resignedAt;
      from = 'resignation date';
    } else if (member.updatedAt) {
      at = member.updatedAt;
      from = 'last change to his record';
    }
    if (!at) continue;

    if (!dryRun) {
      await Member.updateOne({ _id: member._id }, { $set: { deactivatedAt: at } }, { timestamps: false });
    }
    filled.push({ id: member._id, name: member.name, at, from });
  }
  return { checked: missing.length, filled };
}

module.exports = { backfillDeactivatedAt };
