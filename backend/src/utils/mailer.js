const dns = require('dns');
const net = require('net');
const nodemailer = require('nodemailer');
const { logEvent } = require('../middleware/requestLogger');
const { CHAMA_NAME } = require('../data/branding');

// One email concern per place: validation helpers here, sending below, and the
// reminder template at the bottom. Nothing in this module throws on import —
// the app must run fine on a deployment with no SMTP credentials configured,
// it just can't send.

let transporter = null;
// Which address the transport was built for, and when that was decided. Kept so a
// provider that moves is followed without a lookup per message.
let transportAddress = null;
let transportResolvedAt = 0;

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

// -----------------------------------------------------------------------------
// The HTTPS transport (a mail API on 443)
// -----------------------------------------------------------------------------
//
// The road a host cannot close. Configured with MAIL_API_PROVIDER, MAIL_API_KEY and
// MAIL_FROM. Each provider is three small things — where to check the key, where to post a
// message, and how it wants that message shaped — so adding one is a dozen lines and a change
// nowhere else in this file.
//
// The builders are pure functions taking everything they need as arguments, which is what lets
// every shape be tested without an account, a key or a network.
const API_PROVIDERS = {
  brevo: {
    label: 'Brevo',
    // A cheap authenticated call that answers "is this key real?" without sending anything.
    // This is what verifyMail asks on this road, before a batch trusts it.
    verify: (key) => ({ url: 'https://api.brevo.com/v3/account', headers: { 'api-key': key } }),
    send: ({ key, from, to, subject, text, html }) => ({
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: { 'api-key': key },
      body: {
        sender: from.name ? { email: from.email, name: from.name } : { email: from.email },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      },
    }),
  },

  resend: {
    label: 'Resend',
    verify: (key) => ({
      url: 'https://api.resend.com/domains',
      headers: { Authorization: `Bearer ${key}` },
    }),
    send: ({ key, rawFrom, to, subject, text, html }) => ({
      url: 'https://api.resend.com/emails',
      headers: { Authorization: `Bearer ${key}` },
      // Resend takes the whole From header as one string, which is what MAIL_FROM already is.
      body: { from: rawFrom, to: [to], subject, html, text },
    }),
  },

  sendgrid: {
    label: 'SendGrid',
    verify: (key) => ({
      url: 'https://api.sendgrid.com/v3/scopes',
      headers: { Authorization: `Bearer ${key}` },
    }),
    send: ({ key, from, to, subject, text, html }) => ({
      url: 'https://api.sendgrid.com/v3/mail/send',
      headers: { Authorization: `Bearer ${key}` },
      body: {
        personalizations: [{ to: [{ email: to }] }],
        from: from.name ? { email: from.email, name: from.name } : { email: from.email },
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
      },
    }),
  },
};

// How long one call to a provider may take — the same order as the SMTP road's connection
// timeout, and for the same reason: a provider that accepts the socket and then says nothing
// must not hold the office's request open.
const API_TIMEOUT_MS = 15000;

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

// Which road a send takes, or why there is none. Thrown rather than returned, because every
// caller is about to send something and has nothing useful to do without it.
function activeMailTransport() {
  if (process.env.MAIL_API_KEY) {
    const provider = apiProvider();
    if (!provider) {
      throw mailError(
        `MAIL_API_PROVIDER is ${apiProviderName() ? `"${apiProviderName()}"` : 'not set'}, which this app does not know. `
          + `Use one of: ${Object.keys(API_PROVIDERS).join(', ')} — or unset MAIL_API_KEY to send over SMTP.`
      );
    }
    return { kind: 'api', provider };
  }

  assertMailConfigured();
  return { kind: 'smtp' };
}

// The provider's own words for a refusal, whichever shape it uses: Brevo answers
// { code, message }, Resend { message }, SendGrid { errors: [{ message }] }. "Key not found"
// is worth a great deal more to the office than "HTTP 401", because it says which of the two
// things to go and fix.
function providerMessage(payload, status) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.message === 'string' && payload.message) return payload.message;
    if (typeof payload.error === 'string' && payload.error) return payload.error;
    const first = Array.isArray(payload.errors) ? payload.errors[0] : null;
    if (first && typeof first.message === 'string' && first.message) return first.message;
  }
  return `HTTP ${status}`;
}

// One call to a provider: its key check, or one message.
//
// Failures are labelled the way the SMTP road labels its own, so everything downstream —
// mailFailure, the reminders screen, the weekly sweep — explains them the same way: a code
// meaning the socket never got there, or a code meaning the provider answered and refused.
async function apiCall({ url, headers, body, label }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    // A refusal to connect carries its own code — ENOTFOUND, ECONNREFUSED,
    // UND_ERR_CONNECT_TIMEOUT — and that is what tells an operator whether the address or the
    // credentials are in question. The timeout is this app's own, so it is named as one.
    const cause = (err && err.cause) || {};
    const message =
      err.name === 'AbortError'
        ? `${label} did not answer within ${Math.round(API_TIMEOUT_MS / 1000)}s`
        : cause.code
          ? `${cause.code}: ${cause.message || err.message}`
          : err.message;

    const failed = new Error(message);
    failed.code = err.name === 'AbortError' ? 'ETIMEDOUT' : cause.code || 'EHTTP';
    throw failed;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => '');
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // A body that is not JSON — an HTML error page from a proxy, say — is left as text for the
    // message to fall back on.
  }

  if (!response.ok) {
    const refused = new Error(providerMessage(payload, response.status));
    // 401/403 is the key; anything else is the provider refusing this message. Neither is a
    // connection failure, and saying so is the whole point of carrying a code.
    refused.code = response.status === 401 || response.status === 403 ? 'EAUTH' : 'EPROVIDER';
    refused.responseCode = response.status;
    throw refused;
  }

  return { payload, text, status: response.status };
}

// One message, posted to the provider. Returns the same shape the SMTP road returns, so that
// nothing downstream can tell the two apart — which is the point of having two.
async function sendViaApi(provider, { to, subject, html, text }) {
  const request = provider.send({
    key: process.env.MAIL_API_KEY,
    from: mailFrom(),
    rawFrom: process.env.MAIL_FROM,
    to,
    subject,
    text,
    html,
  });

  const { payload } = await apiCall({ ...request, label: provider.label });
  return {
    messageId: (payload && (payload.messageId || payload.id)) || null,
    response: `HTTP 200 (${provider.label})`,
  };
}

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

// `to` is deliberately the only caller-supplied recipient — every send in this
// app is triggered by an admin from the reminders page, never by member input.
async function sendMail({ to, subject, html, text }) {
  // Which road is decided here, and only here: everything above this line — the reminders
  // screen and the weekly sweep — asks "send this message" and gets told what happened,
  // without knowing whether it left over SMTP or HTTPS.
  const transport = activeMailTransport();

  // Checked before anything is attempted, on both roads: the From is the one field a deployment
  // gets wrong in a way the provider reports cryptically, and the check costs a regex.
  mailFrom();

  if (transport.kind === 'api') {
    return sendViaApi(transport.provider, { to, subject, html, text });
  }

  // getTransporter refuses with the not-configured 503 itself, so every sender says
  // the same thing instead of each carrying its own copy of the sentence.
  const tx = await getTransporter();
  return tx.sendMail({
    from: process.env.MAIL_FROM,
    replyTo: process.env.MAIL_REPLY_TO || undefined,
    to,
    subject,
    text,
    html,
  });
}

// Does the configuration in front of us actually work, without sending anything?
//
// "The variables are set" and "this host can reach the provider with these
// credentials" are different facts, and only the second one delivers mail. This is
// the check that tells them apart, and the one a batch runs before its first message
// (see deliverReminders) — because with an unreachable provider every send spends its
// own connection timeout discovering the same fault, so a batch of fifty becomes a
// quarter of an hour of waiting and the office, whose client gives up in twenty
// seconds, never hears why.
async function verifyMail() {
  const transport = activeMailTransport();

  if (transport.kind === 'api') {
    // The provider's cheapest authenticated call, which answers "is this key real?" without
    // posting a message: the same question, asked the way this road can answer it.
    await apiCall({
      ...transport.provider.verify(process.env.MAIL_API_KEY),
      label: transport.provider.label,
    });
    return;
  }

  const tx = await getTransporter();
  await tx.verify();
}

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

// -----------------------------------------------------------------------------
// Reminder template
// -----------------------------------------------------------------------------

const money = (amount) => `Ksh ${Number(amount || 0).toLocaleString('en-KE')}`;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Late weeks arrive as [{ weekNumber, typeName, shortfall }] and pending fines
// as [{ reason, remaining }]. Both lists are plain text in the email body — no
// tables, so it renders identically in Gmail, Outlook and a phone's mail app.
function buildReminderEmail({ chamaName, member, lateWeeks = [], fines = [], note = '' }) {
  const firstName = String(member.name || '').split(' ')[0] || 'member';
  const finesTotal = fines.reduce((sum, f) => sum + (f.remaining || 0), 0);
  const lateTotal = lateWeeks.reduce((sum, w) => sum + (w.shortfall || 0), 0);
  const total = finesTotal + lateTotal;

  const lines = [`Hi ${firstName},`, '', `This is a reminder from ${chamaName}.`];

  if (lateWeeks.length > 0) {
    lines.push(
      '',
      `Outstanding weekly contributions (${money(lateTotal)}):`,
      ...lateWeeks.map(
        (w) => `  • Week ${w.weekNumber} — ${w.typeName}: ${money(w.shortfall)} short`
      )
    );
  }

  if (fines.length > 0) {
    lines.push(
      '',
      `Unpaid fines (${money(finesTotal)}):`,
      ...fines.map((f) => `  • ${f.reason || 'Fine'}: ${money(f.remaining)}`)
    );
  }

  if (total > 0) {
    lines.push('', `Total outstanding: ${money(total)}`);
  }

  if (note) {
    lines.push('', note);
  }

  lines.push('', `Thank you,`, `${chamaName}`);

  const text = lines.join('\n');
  const subject = lateWeeks.length > 0 && fines.length > 0
    ? `${chamaName}: contributions and fines still outstanding`
    : fines.length > 0
      ? `${chamaName}: fine payment outstanding`
      : `${chamaName}: contributions still outstanding`;

  const section = (heading, items) =>
    items.length === 0
      ? ''
      : `<p style="margin:16px 0 4px;font-weight:700">${escapeHtml(heading)}</p><ul style="margin:0;padding-left:18px">${items}</ul>`;

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1b2b24">
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>This is a reminder from <strong>${escapeHtml(chamaName)}</strong>.</p>
    ${section(
      `Outstanding weekly contributions — ${money(lateTotal)}`,
      lateWeeks.map(
        (w) =>
          `<li>Week ${escapeHtml(w.weekNumber)} — ${escapeHtml(w.typeName)}: <strong>${money(w.shortfall)}</strong> short</li>`
      )
    )}
    ${section(
      `Unpaid fines — ${money(finesTotal)}`,
      fines.map((f) => `<li>${escapeHtml(f.reason || 'Fine')}: <strong>${money(f.remaining)}</strong></li>`)
    )}
    ${total > 0 ? `<p style="margin:16px 0 0">Total outstanding: <strong>${money(total)}</strong></p>` : ''}
    ${note ? `<p style="margin:16px 0 0">${escapeHtml(note)}</p>` : ''}
    <p style="margin:16px 0 0">Thank you,<br>${escapeHtml(chamaName)}</p>
  </div>`;

  return { subject, text, html };
}

// -----------------------------------------------------------------------------
// Fine emails
// -----------------------------------------------------------------------------
//
// A fine is issued, or a fine is paid. Both are things the member has to be told: a
// fine he never heard about becomes an argument at the next meeting, and a payment
// that is never acknowledged is a payment he may make twice. These are the group's own
// fine records speaking — the same figures the fines screen shows — not a second
// version of them.
//
// The two messages share one shape (the group, the member's own name, the figure, the
// reason, what happens next), so a member reading them a fortnight apart recognises
// the second as the same conversation as the first.

function fineDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// One fine, just issued.
function buildFineIssuedEmail({ chamaName, member, fine = {} }) {
  const group = chamaName || CHAMA_NAME;
  const firstName = String(member?.name || '').split(' ')[0] || 'member';
  const typeName = fine.typeName || 'Fine';
  const reason = String(fine.reason || '').trim();
  const amount = Number(fine.amount) || 0;
  const remaining = Number(fine.remaining ?? amount) || 0;
  const issued = fineDate(fine.date);

  const lines = [
    `Hi ${firstName},`,
    '',
    `A fine has been recorded against you by ${group}.`,
    '',
    `  • ${typeName}${reason ? ` — ${reason}` : ''}: ${money(amount)}`,
    issued ? `  • Dated: ${issued}` : '',
    '',
    `What is still owed: ${money(remaining)}.`,
    '',
    'You can settle it at the next meeting, or by sending the amount to the group with',
    'the reference of this fine. If you believe it was recorded in error, speak to the',
    'office before paying.',
    '',
    'Thank you,',
    group,
  ];

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1b2b24">
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>A fine has been recorded against you by <strong>${escapeHtml(group)}</strong>.</p>
    <p style="margin:16px 0 4px;font-weight:700">${escapeHtml(typeName)}${
      reason ? ` — ${escapeHtml(reason)}` : ''
    }</p>
    <p style="margin:0">Amount: <strong>${money(amount)}</strong>${
      issued ? ` &middot; dated ${escapeHtml(issued)}` : ''
    }</p>
    <p style="margin:16px 0 0">Still owed: <strong>${money(remaining)}</strong></p>
    <p style="margin:16px 0 0">You can settle it at the next meeting, or by sending the amount to
    the group with the reference of this fine. If you believe it was recorded in error, speak to
    the office before paying.</p>
    <p style="margin:16px 0 0">Thank you,<br>${escapeHtml(group)}</p>
  </div>`;

  return {
    subject: `${group}: a fine of ${money(amount)} has been recorded`,
    text: lines.join('\n'),
    html,
  };
}

// A fine — or several, when one payment cleared more than one — just paid. One email
// per payment rather than per fine, because that is how the money arrived and how the
// member will remember it.
function buildFineSettledEmail({ chamaName, member, payments = [], totalPaid = 0, paidAt, note = '' }) {
  const group = chamaName || CHAMA_NAME;
  const firstName = String(member?.name || '').split(' ')[0] || 'member';
  const paid = Number(totalPaid) || payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const when = fineDate(paidAt);
  const outstanding = payments.reduce((sum, p) => sum + (Number(p.remaining) || 0), 0);

  const lines = [
    `Hi ${firstName},`,
    '',
    `Thank you — your fine payment has been received by ${group}.`,
    '',
    `  Amount paid: ${money(paid)}${when ? ` (${when})` : ''}`,
    ...payments.map(
      (p) =>
        `  • ${p.label || 'Fine'}: ${money(p.amount)}${
          Number(p.remaining) > 0 ? ` — ${money(p.remaining)} still owed` : ' — cleared'
        }`
    ),
    '',
    outstanding > 0
      ? `You still owe ${money(outstanding)} on the fine${payments.length === 1 ? '' : 's'} above.`
      : 'Nothing is outstanding on this fine.',
    note ? `\n${note}` : '',
    '',
    'Thank you,',
    group,
  ];

  const items = payments
    .map(
      (p) =>
        `<li>${escapeHtml(p.label || 'Fine')}: <strong>${money(p.amount)}</strong>${
          Number(p.remaining) > 0
            ? ` — ${money(p.remaining)} still owed`
            : ' — cleared'
        }</li>`
    )
    .join('');

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1b2b24">
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Thank you — your fine payment has been received by <strong>${escapeHtml(group)}</strong>.</p>
    <p style="margin:16px 0 4px">Amount paid: <strong>${money(paid)}</strong>${
      when ? ` &middot; ${escapeHtml(when)}` : ''
    }</p>
    ${items ? `<ul style="margin:0;padding-left:18px">${items}</ul>` : ''}
    ${
      outstanding > 0
        ? `<p style="margin:16px 0 0">You still owe <strong>${money(outstanding)}</strong>.</p>`
        : '<p style="margin:16px 0 0">Nothing is outstanding on this fine.</p>'
    }
    ${note ? `<p style="margin:16px 0 0">${escapeHtml(note)}</p>` : ''}
    <p style="margin:16px 0 0">Thank you,<br>${escapeHtml(group)}</p>
  </div>`;

  return {
    subject: `${group}: fine payment of ${money(paid)} received`,
    text: lines.join('\n'),
    html,
  };
}

module.exports = {
  cleanEmail,
  isValidEmail,
  isMailConfigured,
  assertMailConfigured,
  describeMailConfig,
  describeMailError,
  isConnectionFailure,
  describeMailEndpoint,
  mailFailure,
  // The HTTPS road, also exported for the test: the request shapes are pure builders, and the
  // question of which road a deployment is on is answered with no network at all.
  parseMailFrom,
  providerMessage,
  mailConfigurationProblem,
  activeMailTransport,
  // Exported for the test, which checks the two decisions that make a message reachable
  // on a host without outbound IPv6 — the literal address and the TLS server name —
  // without opening a connection to anything.
  resolveIpv4,
  transportOptions,
  sendMail,
  verifyMail,
  buildReminderEmail,
  // The two fine messages, exported for the test: what a member is told when a fine is
  // recorded against him and when his payment for it arrives is decided here, with no
  // mail server involved.
  buildFineIssuedEmail,
  buildFineSettledEmail,
};