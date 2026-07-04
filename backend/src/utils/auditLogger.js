const AuditLog = require('../models/AuditLog');

// Writes an audit entry for every create/update/delete on Member or Contribution.
// before/after are full document snapshots (null on create/delete respectively).
// An audit write failure is logged but does not roll back the operation itself.
async function logAudit({ action, entityType, entityId, performedBy, before = null, after = null }) {
  try {
    await AuditLog.create({ action, entityType, entityId, performedBy, before, after });
  } catch (err) {
    console.error(`Audit log write failed (${action} ${entityType} ${entityId}):`, err.message);
  }
}

// Plain-object snapshot of a mongoose doc, safe to store in a Mixed field.
function snapshot(doc) {
  return doc ? JSON.parse(JSON.stringify(doc.toObject ? doc.toObject() : doc)) : null;
}

module.exports = { logAudit, snapshot };
