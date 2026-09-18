const { logEvent } = require('./requestLogger');

function notFound(req, res) {
  res.status(404).json({ message: 'Not found' });
}

// Every error the API raises comes through here, so this is where the shape of a
// failure is decided:
//
//   * Mongo's own errors are translated (duplicate key → 409 naming the field,
//     validation → 400 with the field's message, bad id → 400).
//   * 4xx messages written by our own code are shown as written.
//   * 5xx messages are never shown to a client in production, and the detail goes
//     to the log with the request id, the route and the account — so "it said
//     something went wrong" is traceable from a log line instead of a guess.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const rid = req?.id;

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    // A client-supplied duplicate is a 409 with a message the office can act on.
    logEvent('duplicate_key', { rid, field, path: req?.path }, 'warn');
    return res.status(409).json({ message: `A record with that ${field} already exists` });
  }
  if (err.name === 'ValidationError') {
    const first = Object.values(err.errors)[0];
    return res.status(400).json({ message: first ? first.message : 'Invalid data' });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid id' });
  }

  const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599
    ? err.status
    : 500;

  if (status >= 500) {
    // Stack, route and account in one line; `err` alone loses all three.
    logEvent(
      'request_failed',
      {
        rid,
        method: req?.method,
        path: req?.path,
        userId: req?.user ? String(req.user._id) : undefined,
        status,
        error: err.message,
        stack: String(err.stack || '').split('\n').slice(0, 4).join(' | '),
      },
      'error'
    );
  }

  // `err.expose` marks a message written for a person to read (a rejected upload,
  // a validation the controller phrased). Anything else 5xx is the generic line in
  // production; in development the real message is worth the risk.
  const showMessage =
    status < 500 || err.expose === true || process.env.NODE_ENV !== 'production';

  res.status(status).json({
    message: showMessage ? err.message : 'Something went wrong',
    ...(rid ? { requestId: rid } : {}),
  });
}

module.exports = { notFound, errorHandler };
