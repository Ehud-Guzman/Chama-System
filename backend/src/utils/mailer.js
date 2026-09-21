const nodemailer = require('nodemailer');

// One email concern per place: validation helpers here, sending below, and the
// reminder template at the bottom. Nothing in this module throws on import —
// the app must run fine on a deployment with no SMTP credentials configured,
// it just can't send.

let transporter = null;

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

function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

// The one error every caller gets when there is nothing to send with.
//
// One function rather than one sentence copied into four places — the reminders
// screen before it accepts a batch, the weekly sweep, the test button, and the
// senders themselves — because four copies of a message drift apart.
//
// `expose` is what makes the sentence reach the office at all. middleware/
// errorHandler shows a 5xx message only when the error is marked as written for a
// person, so without it the screen said "Something went wrong" exactly where the
// README promises the explanation.
function assertMailConfigured() {
  if (isMailConfigured()) return;

  const err = new Error(
    'Email sending is not set up yet. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM to the server environment.'
  );
  err.status = 503;
  err.expose = true;
  throw err;
}

// Port 465 is implicit TLS; 587/25 start plain and upgrade via STARTTLS.
// SMTP_SECURE can still override this for an unusual provider. One function, so the
// status endpoint cannot report a different answer from the one the transport uses.
function secureForPort(port) {
  return process.env.SMTP_SECURE
    ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
    : port === 465;
}

function getTransporter() {
  if (transporter) return transporter;
  assertMailConfigured();

  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: secureForPort(port),
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
  });
  return transporter;
}

// `to` is deliberately the only caller-supplied recipient — every send in this
// app is triggered by an admin from the reminders page, never by member input.
async function sendMail({ to, subject, html, text }) {
  // getTransporter refuses with the not-configured 503 itself, so every sender says
  // the same thing instead of each carrying its own copy of the sentence.
  return getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    replyTo: process.env.MAIL_REPLY_TO || undefined,
    to,
    subject,
    text,
    html,
  });
}

// Opens a connection and authenticates, and sends nothing.
//
// "The variables are set" and "this host can reach the provider with these
// credentials" are different facts, and only the second one delivers mail. This is
// the check that tells them apart, and the one a batch runs before its first message
// (see deliverReminders) — because with an unreachable provider every send spends its
// own connection timeout discovering the same fault, so a batch of fifty becomes a
// quarter of an hour of waiting and the office, whose client gives up in twenty
// seconds, never hears why.
async function verifyMail() {
  await getTransporter().verify();
}

// What an operator needs from a failed send: the library's own code (535, ETIMEDOUT,
// ESOCKET) in front of its sentence, and never the credentials. Truncated, because an
// SMTP server's answer can be a paragraph and this text goes into a 503 body.
function describeMailError(err) {
  const code = err && (err.responseCode || err.code);
  const detail = String((err && err.message) || err || 'unknown error').slice(0, 300);
  return code && !detail.includes(String(code)) ? `${code}: ${detail}` : detail;
}

// The settings, never the secret: the host, the port and the sending address are what
// an operator checks when nothing arrives, and all three are already on the provider's
// own dashboard. SMTP_USER and SMTP_PASS never leave this module.
function describeMailConfig() {
  const port = Number(process.env.SMTP_PORT) || 587;
  const configured = isMailConfigured();
  return {
    configured,
    from: configured ? process.env.MAIL_FROM : null,
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

// The office's own test message (POST /api/notifications/test).
//
// Deliberately plain, and deliberately not a reminder: it exists to prove the one
// thing a reminder cannot prove about itself — that the server opened a connection,
// signed in and was accepted — and to be forwardable to whoever keeps the mailbox.
// A real reminder would be mistaken for a member's business.
function buildTestEmail({ chamaName }) {
  const name = String(chamaName || '').trim() || 'the chama';
  const subject = `${name}: test email from the chama system`;

  const text = [
    `This is a test message from ${name}'s chama system.`,
    '',
    'Nobody was reminded by it. If you are reading it, then:',
    '',
    '  • the server reached the mail provider;',
    '  • it signed in as the sending account, if one is configured;',
    '  • the message was accepted for delivery — not merely written to a file.',
    '',
    'So if a member says a reminder never arrived while this one did, the system is not',
    'the reason: check his address on his member record, and whether email reminders are',
    'switched on for him.',
    '',
    `— ${name}`,
  ].join('\n');

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1b2b24">
    <p>This is a <strong>test message</strong> from ${escapeHtml(name)}&rsquo;s chama system.</p>
    <p>Nobody was reminded by it. If you are reading it, then the server reached the mail provider, signed in as the sending account, and the message was accepted for delivery.</p>
    <p>So if a member says a reminder never arrived while this one did, the system is not the reason: check his address on his member record, and whether email reminders are switched on for him.</p>
    <p style="margin:16px 0 0">Thank you,<br>${escapeHtml(name)}</p>
  </div>`;

  return { subject, text, html };
}

module.exports = {
  cleanEmail,
  isValidEmail,
  isMailConfigured,
  assertMailConfigured,
  describeMailConfig,
  describeMailError,
  sendMail,
  verifyMail,
  buildReminderEmail,
  buildTestEmail,
};