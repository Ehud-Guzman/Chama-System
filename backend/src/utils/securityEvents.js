// Failed sign-ins, stored and counted.
//
// The request log already says `login_failed`; this is the same fact in the database, where the
// super admin's oversight screen can read it, and with the counting that turns "somebody typed a
// wrong password" into "somebody has typed five". Never throws and is never awaited by the
// request: a sign-in that fails must fail the same way and as fast whether or not this works,
// and it must not give a stranger a way to find out whether an address exists by timing it.
const SecurityEvent = require('../models/SecurityEvent');
const { logLoginFailure, logEvent } = require('../middleware/requestLogger');
const { alertOnFailedSignIns, alertOnGateFailures, FAILURE_WINDOW_MS } = require('./superAdminAlerts');

// `user` is the account when there is one; absent for an address that is not an account.
async function recordLoginFailure({ email, ip, rid, reason, user = null }) {
  const address = String(email || '').toLowerCase().trim().slice(0, 160);
  logLoginFailure({ email: address, ip, rid, reason });

  try {
    await SecurityEvent.create({
      reason,
      email: address,
      userId: user ? user._id : null,
      role: user ? user.role : null,
      ip: String(ip || '').slice(0, 64),
    });

    const since = new Date(Date.now() - FAILURE_WINDOW_MS);
    const [countByEmail, countByIp] = await Promise.all([
      SecurityEvent.countDocuments({ kind: 'login_failed', email: address, createdAt: { $gte: since } }),
      ip ? SecurityEvent.countDocuments({ kind: 'login_failed', ip: String(ip).slice(0, 64), createdAt: { $gte: since } }) : 0,
    ]);
    await alertOnFailedSignIns({ email: address, ip, countByEmail, countByIp, accountExists: Boolean(user) });
  } catch (err) {
    logEvent('security_event_failed', { rid, error: err.message }, 'error');
  }
}

// A try at the members' gate that did not open it. `target` is the ID's one-way tag, never the
// number; `member` is the record the ID belongs to, when it belongs to one. Same rules as above:
// never throws, never awaited by the request.
async function recordGateFailure({ reason, target, ip, rid, member = null }) {
  try {
    const address = String(ip || '').slice(0, 64);
    await SecurityEvent.create({
      kind: 'gate_failed',
      reason,
      target: target || '',
      ip: address,
      memberId: member ? member._id : null,
    });

    const since = new Date(Date.now() - FAILURE_WINDOW_MS);
    const [countByIp, countByTarget] = await Promise.all([
      address ? SecurityEvent.countDocuments({ kind: 'gate_failed', ip: address, createdAt: { $gte: since } }) : 0,
      reason === 'wrong_phone' && target
        ? SecurityEvent.countDocuments({ kind: 'gate_failed', target, reason: 'wrong_phone', createdAt: { $gte: since } })
        : 0,
    ]);
    await alertOnGateFailures({ ip: address, countByIp, countByTarget, memberName: member ? member.name : '' });
  } catch (err) {
    logEvent('security_event_failed', { rid, error: err.message }, 'error');
  }
}

module.exports = { recordLoginFailure, recordGateFailure };
