// Mail, part: failures. utils/mailer.js is the index everything else requires.

const { apiProvider } = require('./config');
const { describeMailEndpoint } = require('./smtp');

// What an operator needs from a failed send: the library's own code (535, ETIMEDOUT,
// ESOCKET) in front of its sentence, and never the credentials. Truncated, because an
// SMTP server's answer can be a paragraph and this text goes into a 503 body.
function describeMailError(err) {
  const code = err && (err.responseCode || err.code);
  const detail = String((err && err.message) || err || 'unknown error').slice(0, 300);
  return code && !detail.includes(String(code)) ? `${code}: ${detail}` : detail;
}

// The failures that happened before the provider said anything: a socket that never
// connected, whatever the library called it. Nothing about the credentials, the sender or
// the message was tested, so the answer is at the network or the host — never in the
// mailbox settings — and the sentence below says so instead of leaving somebody to
// re-check an app password that was never the problem.
const CONNECTION_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ESOCKET',
  'ECONNECTION',
  'EDNS',
  'ETLS',
  // The HTTPS road's own names for the same thing, from undici. `EHTTP` is what apiCall labels
  // a fetch that failed with nothing more specific — and fetch only rejects for a reason at the
  // network level, never for a status code.
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'EHTTP',
]);

function isConnectionFailure(err) {
  const code = err && err.code;
  return Boolean(code) && CONNECTION_CODES.has(String(code));
}

// What to try next, which depends on the road. On SMTP the host most often blocks the port —
// Render's Free instances drop 25, 465 and 587 outright — and swapping in a provider that
// listens elsewhere is the cheap answer. On HTTPS it is DNS or an egress firewall, and the API
// itself already depends on 443, so advice about SMTP ports would be advice about nothing.
function connectionHint() {
  return apiProvider()
    ? 'The HTTPS road needs outbound access to the provider on 443, which this API already uses to reach everything else.'
    : 'A host that cannot open that port most often has outbound SMTP switched off — '
      + 'a provider that listens on port 2525, or an HTTPS mail API, works where 587 does not.';
}

// Every mail failure, turned into the sentence that gets shown to whoever asked for the
// send — and marked as written for a person, because middleware/errorHandler hides the text
// of a 5xx otherwise. One function, so the reminders screen, the weekly sweep and the test
// button explain the same fault the same way.
function mailFailure(err) {
  // A rejection this module wrote itself (nothing configured) already reads as it should.
  if (err && err.expose) return err;

  const where = describeMailEndpoint();
  const message = isConnectionFailure(err)
    ? `Nothing answered at ${where || 'the mail server'}: ${describeMailError(err)}. ${connectionHint()}`
    : `The mail server refused the message: ${describeMailError(err)}${where ? ` (at ${where})` : ''}`;

  const wrapped = new Error(message);
  wrapped.status = 503;
  wrapped.expose = true;
  return wrapped;
}

module.exports = {
  describeMailError,
  isConnectionFailure,
  mailFailure,
};
