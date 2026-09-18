const crypto = require('crypto');

// One structured line per request, plus a request id that ties together everything
// the request did — including the error handler's output and any warning raised
// along the way.
//
// JSON rather than a pretty string because the hosts this runs on (Render, Railway)
// capture stdout and let you filter by field. No dependency: a request logger is
// thirty lines, and morgan's format is a worse fit than a field you can search.
//
// Set LOG_LEVEL=silent to switch it off (the test suite does).
const SILENT = process.env.LOG_LEVEL === 'silent' || process.env.NODE_ENV === 'test';

function write(fields) {
  if (SILENT) return;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}

// Anything worth finding later that is not a request: a collection run, a failed
// login, a script's summary, a shutdown.
function logEvent(event, fields = {}, level = 'info') {
  write({ level, event, ...fields });
}

function requestLogger(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    write({
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      event: 'request',
      rid: req.id,
      method: req.method,
      path: req.originalUrl?.split('?')[0] || req.path,
      status: res.statusCode,
      ms: Math.round(ms),
      // The account, when the request was authenticated — never the body, and
      // never a document id (a path is enough to find the call).
      userId: req.user ? String(req.user._id) : undefined,
      ip: req.ip,
    });
  });

  next();
}

// Failed sign-ins are the one thing a rate limiter cannot tell you about: it
// reports 429s, not who was being guessed at. Recorded here, deliberately outside
// the audit trail (which is a record of the books, not of traffic).
function logLoginFailure({ email, ip, rid, reason }) {
  logEvent('login_failed', { email: String(email || '').toLowerCase(), ip, rid, reason }, 'warn');
}

module.exports = { requestLogger, logEvent, logLoginFailure };
