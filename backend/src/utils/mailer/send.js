// Mail, part: send. utils/mailer.js is the index everything else requires.

const { apiProvider, apiProviderName, assertMailConfigured, mailError, mailFrom } = require('./config');
const { API_PROVIDERS } = require('./providers');
const { apiCall, sendViaApi } = require('./api');
const { getTransporter } = require('./smtp');

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

// `to` is deliberately the only caller-supplied recipient — every send in this
// app is triggered by an admin from the reminders page, never by member input.
// `attachments` is [{ filename, content: Buffer, contentType }] and goes out on every road.
async function sendMail({ to, subject, html, text, attachments }) {
  // Which road is decided here, and only here: everything above this line — the reminders
  // screen and the weekly sweep — asks "send this message" and gets told what happened,
  // without knowing whether it left over SMTP or HTTPS.
  const transport = activeMailTransport();

  // Checked before anything is attempted, on both roads: the From is the one field a deployment
  // gets wrong in a way the provider reports cryptically, and the check costs a regex.
  mailFrom();

  if (transport.kind === 'api') {
    return sendViaApi(transport.provider, { to, subject, html, text, attachments });
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
    attachments,
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

module.exports = {
  activeMailTransport,
  sendMail,
  verifyMail,
};
