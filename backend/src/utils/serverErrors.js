const crypto = require('crypto');
const mongoose = require('mongoose');
const ServerError = require('../models/ServerError');
const { logEvent } = require('../middleware/requestLogger');

// Noticing that the server is failing, without a paid monitoring service.
//
// Every 5xx, and every crash the process is about to exit on, is written here (grouped, counted) and
// the super admin is emailed once per distinct fault per quiet period. The Control Room lists them.
//
// Like the audit trail and every email in this system, it can never be the reason a request fails:
// nothing here throws, and nothing here is awaited by the request that caused it.

const RENOTIFY_AFTER_MS = 6 * 60 * 60 * 1000;
const HEX_ID = /[0-9a-f]{24}/gi;

// `/api/members/66f0c…/ledger` and `/api/members/66f0d…/ledger` are one route.
function routeOf(req) {
  const raw = String(req?.baseUrl && req?.route?.path ? req.baseUrl + req.route.path : req?.originalUrl || req?.path || '');
  return raw.split('?')[0].replace(HEX_ID, ':id').slice(0, 200);
}

function signatureOf({ kind, route, message }) {
  return crypto.createHash('sha1').update(`${kind}|${route}|${String(message).slice(0, 160)}`).digest('hex').slice(0, 16);
}

async function recordServerError({ err, req = null, kind = 'request', status = 500 }) {
  try {
    // Without a database there is nowhere to write; the request log has the line already.
    if (mongoose.connection?.readyState !== 1) return null;

    const message = String(err?.message || err || 'Unknown error').slice(0, 400);
    const route = req ? routeOf(req) : '';
    const signature = signatureOf({ kind, route, message });
    const now = new Date();

    const row = await ServerError.findOneAndUpdate(
      { signature },
      {
        $inc: { count: 1 },
        $set: {
          lastAt: now,
          lastRequestId: String(req?.id || ''),
          status,
          stack: String(err?.stack || '').split('\n').slice(0, 4).join('\n').slice(0, 800),
        },
        $setOnInsert: { kind, message, method: String(req?.method || ''), route, firstAt: now },
      },
      { upsert: true, new: true }
    );

    const due = !row.notifiedAt || now - row.notifiedAt > RENOTIFY_AFTER_MS;
    if (due) {
      // Marked first: two failures a millisecond apart must not send two emails.
      const claimed = await ServerError.findOneAndUpdate(
        { _id: row._id, $or: [{ notifiedAt: null }, { notifiedAt: { $lt: new Date(now - RENOTIFY_AFTER_MS) } }] },
        { $set: { notifiedAt: now } }
      );
      if (claimed) {
        // Required here, not at the top: the alerts module reaches the models and the mailer.
        const { alertOnServerError } = require('./superAdminAlerts');
        await alertOnServerError({ kind, message, route, method: row.method, count: row.count, requestId: row.lastRequestId, at: now });
      }
    }
    return row;
  } catch (e) {
    logEvent('server_error_record_failed', { error: e.message }, 'error');
    return null;
  }
}

// What the Control Room shows: the last week, newest first.
async function recentServerErrors({ days = 7, limit = 10 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await ServerError.find({ lastAt: { $gte: since } }).sort({ lastAt: -1 }).limit(limit).lean();
  const [totals] = await ServerError.aggregate([
    { $match: { lastAt: { $gte: since } } },
    { $group: { _id: null, distinct: { $sum: 1 }, total: { $sum: '$count' } } },
  ]);
  return {
    days,
    distinct: totals?.distinct || 0,
    total: totals?.total || 0,
    recent: rows.map((r) => ({
      id: r._id,
      kind: r.kind,
      message: r.message,
      method: r.method,
      route: r.route,
      count: r.count,
      firstAt: r.firstAt,
      lastAt: r.lastAt,
      requestId: r.lastRequestId || null,
    })),
  };
}

module.exports = { recordServerError, recentServerErrors, routeOf, signatureOf, RENOTIFY_AFTER_MS };
