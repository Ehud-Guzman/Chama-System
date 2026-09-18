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

function getTransporter() {
  if (transporter) return transporter;
  if (!isMailConfigured()) return null;

  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // Port 465 is implicit TLS; 587/25 start plain and upgrade via STARTTLS.
    // SMTP_SECURE can still override this for an unusual provider.
    secure: process.env.SMTP_SECURE
      ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
      : port === 465,
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
  const tx = getTransporter();
  if (!tx) {
    const err = new Error(
      'Email sending is not set up yet. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM to the server environment.'
    );
    err.status = 503;
    throw err;
  }

  return tx.sendMail({
    from: process.env.MAIL_FROM,
    replyTo: process.env.MAIL_REPLY_TO || undefined,
    to,
    subject,
    text,
    html,
  });
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

module.exports = {
  cleanEmail,
  isValidEmail,
  isMailConfigured,
  sendMail,
  buildReminderEmail,
};