// Mail, part: smtp. utils/mailer.js is the index everything else requires.

const dns = require('dns');
const net = require('net');
const nodemailer = require('nodemailer');
const { logEvent } = require('../../middleware/requestLogger');
const { apiProvider, assertMailConfigured, secureForPort } = require('./config');

// One email concern per place: validation helpers here, sending below, and the
// reminder template at the bottom. Nothing in this module throws on import —
// the app must run fine on a deployment with no SMTP credentials configured,
// it just can't send.

let transporter = null;

// Which address the transport was built for, and when that was decided. Kept so a
// provider that moves is followed without a lookup per message.
let transportAddress = null;

let transportResolvedAt = 0;

// How long a resolved address is trusted. The same five minutes nodemailer caches its own
// answers for, so following a provider that moves costs no more lookups than the library
// would have made anyway.
const DNS_TTL_MS = 5 * 60 * 1000;

// The provider's address, resolved to IPv4 before nodemailer is handed anything.
//
// That is not an optimisation. It is the difference between sending and not sending on a
// host with no outbound IPv6: nodemailer 10 resolves both families itself, picks one of
// them at random, and treats IPv6 as usable when any local interface carries an IPv6
// address — a test that passes inside a container that has an IPv6 interface and no IPv6
// route, which is exactly what Render gives you. Seen live from that host:
//
//   ESOCKET: connect ENETUNREACH 2607:f8b0:400e:c1e::6d:587
//
// Its fallback cannot rescue that either: when its own IPv4 query comes back empty it is
// left holding IPv6 addresses only, so every attempt reaches for an address this host
// cannot use, and the office is told the mail server refused a message it was never sent.
// An IPv4 literal skips its resolver entirely.
//
// A null answer means "leave nodemailer to it", which is what this file did before: a
// lookup that cannot run must never be the reason mail stops going out.
async function resolveIpv4(hostname, lookup = dns.promises.lookup) {
  // An address needs no resolving — and one that is already an IPv6 literal is somebody's
  // deliberate choice, which this must not quietly override.
  if (net.isIP(hostname)) return null;

  try {
    const { address } = await lookup(hostname, { family: 4 });
    return address || null;
  } catch {
    return null;
  }
}

// The transport's own settings, kept apart from its creation so the two decisions that
// matter can be checked without a network: the address (an IPv4 literal when we have one)
// and the TLS server name (the hostname, because no provider's certificate is issued to an
// address — and without it, connecting to a literal fails verification rather than
// silently skipping it).
function transportOptions({ hostname, address, port }) {
  return {
    host: address || hostname,
    port,
    secure: secureForPort(port),
    ...(address ? { tls: { servername: hostname } } : {}),
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    // Reuse connections: a batch of reminders is a handful of messages in a row,
    // and a fresh TLS handshake per member is seconds of the request's budget.
    pool: true,
    maxConnections: 3,
    // Every send has a ceiling. Without these, an SMTP host that accepts the
    // connection and then goes quiet holds the request open until the proxy times
    // it out — and the treasurer never learns which members were emailed.
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  };
}

async function getTransporter() {
  assertMailConfigured();

  if (transporter && Date.now() - transportResolvedAt < DNS_TTL_MS) return transporter;

  const hostname = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const address = await resolveIpv4(hostname);

  if (transporter) {
    // Still where it was, or the lookup failed this time: an address that works is not
    // thrown away over one missing answer.
    if (!address || address === transportAddress) {
      transportResolvedAt = Date.now();
      return transporter;
    }
    // It moved. The pooled sockets are talking to the address that went away.
    transporter.close();
    transporter = null;
  }

  transporter = nodemailer.createTransport(transportOptions({ hostname, address, port }));
  transportAddress = address;
  transportResolvedAt = Date.now();
  // Worth a line of its own: when a provider cannot be reached, the first question is
  // which address this process was talking to, and which family it chose.
  logEvent('mail_transport_ready', {
    host: hostname,
    address: address || hostname,
    family: address ? 4 : null,
    port,
    secure: secureForPort(port),
  });

  return transporter;
}

// Where the next send will actually go, as one line an operator can act on: the hostname
// from the environment and the address the process resolved it to. Worth printing beside a
// failure, because "Connection timeout" on its own does not say which address was tried,
// and the first question is always whether it is the address or the port.
function describeMailEndpoint() {
  // The road that is actually configured, not the one that might be: a message about "the
  // mail server" that names a host this deployment is not using sends somebody to the wrong
  // place entirely.
  const api = apiProvider();
  if (api) return `${api.label} over HTTPS`;

  const hostname = process.env.SMTP_HOST;
  if (!hostname) return null;

  const port = Number(process.env.SMTP_PORT) || 587;
  return `${hostname}:${port}${transportAddress ? ` (IPv4 ${transportAddress})` : ''}`;
}

module.exports = {
  describeMailEndpoint,
  getTransporter,
  resolveIpv4,
  transportOptions,
};
