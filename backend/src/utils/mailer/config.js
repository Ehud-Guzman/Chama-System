// Mail, part: config. utils/mailer.js is the index everything else requires.

const { API_PROVIDERS } = require('./providers');

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

function cleanEmail(value) {
  return String(value == null ? '' : value).trim();
}

// Empty is valid — email is optional for members and for next of kin.
function isValidEmail(value) {
  return !value || /^\S+@\S+\.\S+$/.test(value);
}

// -----------------------------------------------------------------------------
// Sending
// -----------------------------------------------------------------------------

// Two roads to the same place, and the deployment decides which one is open.
//
//   SMTP (`SMTP_HOST` + `MAIL_FROM`) — what every provider speaks, and the road a host can
//   refuse to open: Render's Free instances drop outbound 25, 465 and 587 outright, which
//   leaves the reminders screen reporting a timeout nobody can do anything about.
//
//   A mail API over HTTPS (`MAIL_API_PROVIDER` + `MAIL_API_KEY` + `MAIL_FROM`) — the same
//   providers' REST endpoint on 443, which is the port this API already talks to its own
//   database and its clients on, so no host policy closes it without taking the whole app
//   down with it. On a host that blocks SMTP, this is the road that works.
//
// A key wins when both are configured: whoever set one up meant it.
function isMailConfigured() {
  if (!process.env.MAIL_FROM) return false;
  if (process.env.MAIL_API_KEY) return Boolean(apiProvider());
  return Boolean(process.env.SMTP_HOST);
}

// The shape of a failure written for a person: a 503 whose message survives
// middleware/errorHandler in production, which hides a 5xx body unless the error is marked
// `expose`. Every message below that an office could act on goes through here.
function mailError(message) {
  const err = new Error(message);
  err.status = 503;
  err.expose = true;
  return err;
}

// The one error every caller gets when there is nothing to send with.
//
// One function rather than one sentence copied into three places — the reminders screen
// before it accepts a batch, the weekly sweep, and the senders themselves — because three
// copies of a message drift apart.
function assertMailConfigured() {
  if (isMailConfigured()) return;

  throw mailError(
    'Email sending is not set up yet. Set SMTP_HOST (with MAIL_FROM) to send through an SMTP '
      + 'provider, or MAIL_API_PROVIDER and MAIL_API_KEY (with MAIL_FROM) to send through a mail '
      + 'API over HTTPS.'
  );
}

// Port 465 is implicit TLS; 587/25 start plain and upgrade via STARTTLS.
// SMTP_SECURE can still override this for an unusual provider. One function, so the
// status endpoint cannot report a different answer from the one the transport uses.
function secureForPort(port) {
  return process.env.SMTP_SECURE
    ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
    : port === 465;
}

// `MAIL_FROM` as a person writes it, split into what the providers want: `Wazo Moja
// <chama@example.com>`, a quoted display name, or a bare address.
function parseMailFrom(value) {
  const raw = String(value || '').trim();
  const angled = raw.match(/^(.*?)<([^>]+)>\s*$/);
  if (!angled) return { email: raw, name: null };

  return {
    email: angled[2].trim(),
    // Straight quotes are only how a name containing a comma or a full stop has to be written;
    // they are not part of the name.
    name: angled[1].trim().replace(/^"|"$/g, '') || null,
  };
}

function apiProviderName() {
  return String(process.env.MAIL_API_PROVIDER || '').trim().toLowerCase();
}

// MAIL_FROM, parsed and checked.
//
// Providers answer a From that is not an address with something like Brevo's "valid sender
// email required", which names neither the variable nor the file it lives in — and the office
// reads that on a screen which cannot tell them what to type. So it is answered here instead,
// beside the value that was read and the shape that is wanted.
function mailFrom() {
  const raw = String(process.env.MAIL_FROM || '').trim();
  if (!raw) throw mailError('MAIL_FROM is not set, so there is no address to send as.');

  const parsed = parseMailFrom(raw);
  if (!parsed.email || !isValidEmail(parsed.email)) {
    throw mailError(
      `MAIL_FROM does not contain an email address: "${raw.slice(0, 80)}". `
        + 'It must look like Chama Name <chama@example.com>, or be the bare address.'
    );
  }
  return parsed;
}

// The configured provider, or null when there is no usable API configuration. Never throws:
// the status endpoint and the reminders list ask this on every page load.
function apiProvider() {
  if (!process.env.MAIL_API_KEY) return null;
  const name = apiProviderName();
  return API_PROVIDERS[name] ? { name, ...API_PROVIDERS[name] } : null;
}

// Why a configuration that looks set cannot send, said out loud. A key with no provider name
// is otherwise a deployment that reports itself configured while sending nothing, which is the
// worst of both answers.
function mailConfigurationProblem() {
  if (!process.env.MAIL_FROM) return 'MAIL_FROM is not set, so there is no address to send as.';

  if (process.env.MAIL_API_KEY && !apiProvider()) {
    const name = apiProviderName();
    return `MAIL_API_PROVIDER is ${name ? `"${name}"` : 'not set'}, which this app does not know. Use one of: ${Object.keys(API_PROVIDERS).join(', ')}.`;
  }
  if (!process.env.MAIL_API_KEY && !process.env.SMTP_HOST) {
    return 'Neither SMTP_HOST nor MAIL_API_KEY is set, so there is nothing to send through.';
  }
  return null;
}

// The settings, never the secret: the host, the port and the sending address are what
// an operator checks when nothing arrives, and all three are already on the provider's
// own dashboard. SMTP_USER and SMTP_PASS never leave this module.
function describeMailConfig() {
  const port = Number(process.env.SMTP_PORT) || 587;
  const configured = isMailConfigured();
  const api = apiProvider();

  return {
    configured,
    from: configured ? process.env.MAIL_FROM : null,
    // Which road, and what a screen can say about it. `host`/`port` belong to the SMTP road;
    // the provider's name belongs to the API road; and a configuration that is set but cannot
    // send — a key with no provider name, a from-address missing — is named by `problem`
    // rather than left for somebody to infer from a failure.
    transport: api ? 'api' : process.env.SMTP_HOST ? 'smtp' : null,
    provider: api ? api.label : null,
    problem: mailConfigurationProblem(),
    host: process.env.SMTP_HOST || null,
    port,
    secure: secureForPort(port),
  };
}

module.exports = {
  apiProvider,
  apiProviderName,
  assertMailConfigured,
  cleanEmail,
  describeMailConfig,
  isMailConfigured,
  isValidEmail,
  mailConfigurationProblem,
  mailError,
  mailFrom,
  parseMailFrom,
  secureForPort,
};
