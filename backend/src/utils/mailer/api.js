// Mail, part: api. utils/mailer.js is the index everything else requires.

const { mailFrom } = require('./config');

// How long one call to a provider may take — the same order as the SMTP road's connection
// timeout, and for the same reason: a provider that accepts the socket and then says nothing
// must not hold the office's request open.
const API_TIMEOUT_MS = 15000;

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
async function sendViaApi(provider, { to, subject, html, text, attachments }) {
  const request = provider.send({
    key: process.env.MAIL_API_KEY,
    from: mailFrom(),
    rawFrom: process.env.MAIL_FROM,
    to,
    subject,
    text,
    html,
    attachments,
  });

  const { payload } = await apiCall({ ...request, label: provider.label });
  return {
    messageId: (payload && (payload.messageId || payload.id)) || null,
    response: `HTTP 200 (${provider.label})`,
  };
}

module.exports = {
  apiCall,
  providerMessage,
  sendViaApi,
};
