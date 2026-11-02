// Mail, part: providers. utils/mailer.js is the index everything else requires.



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
// The providers take a file as base64 text inside the JSON.
const toBase64 = (content) => (Buffer.isBuffer(content) ? content : Buffer.from(String(content))).toString('base64');

const API_PROVIDERS = {
  brevo: {
    label: 'Brevo',
    // A cheap authenticated call that answers "is this key real?" without sending anything.
    // This is what verifyMail asks on this road, before a batch trusts it.
    verify: (key) => ({ url: 'https://api.brevo.com/v3/account', headers: { 'api-key': key } }),
    send: ({ key, from, to, subject, text, html, attachments }) => ({
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: { 'api-key': key },
      body: {
        sender: from.name ? { email: from.email, name: from.name } : { email: from.email },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        ...(attachments?.length
          ? { attachment: attachments.map((a) => ({ name: a.filename, content: toBase64(a.content) })) }
          : {}),
      },
    }),
  },

  resend: {
    label: 'Resend',
    verify: (key) => ({
      url: 'https://api.resend.com/domains',
      headers: { Authorization: `Bearer ${key}` },
    }),
    send: ({ key, rawFrom, to, subject, text, html, attachments }) => ({
      url: 'https://api.resend.com/emails',
      headers: { Authorization: `Bearer ${key}` },
      // Resend takes the whole From header as one string, which is what MAIL_FROM already is.
      body: {
        from: rawFrom,
        to: [to],
        subject,
        html,
        text,
        ...(attachments?.length
          ? { attachments: attachments.map((a) => ({ filename: a.filename, content: toBase64(a.content) })) }
          : {}),
      },
    }),
  },

  sendgrid: {
    label: 'SendGrid',
    verify: (key) => ({
      url: 'https://api.sendgrid.com/v3/scopes',
      headers: { Authorization: `Bearer ${key}` },
    }),
    send: ({ key, from, to, subject, text, html, attachments }) => ({
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
        ...(attachments?.length
          ? {
              attachments: attachments.map((a) => ({
                content: toBase64(a.content),
                filename: a.filename,
                type: a.contentType || 'application/octet-stream',
                disposition: 'attachment',
              })),
            }
          : {}),
      },
    }),
  },
};

module.exports = {
  API_PROVIDERS,
};
