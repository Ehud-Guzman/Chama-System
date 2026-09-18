const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// Keying helpers.
//
// express-rate-limit v7 warns when a custom keyGenerator hands back a bare IPv6
// address, because a /128 per address is not the same client — a phone on mobile
// data gets a new address whenever it likes. So anything keyed on an address goes
// through here, which collapses an IPv6 client to its /64 network.
function ipKey(req) {
  const ip = String(req.ip || '');
  if (!ip.includes(':')) return ip;
  return ip.split(':').slice(0, 4).join(':');
}

function emailKey(req) {
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();
  return email ? `email:${email}` : null;
}

// Admin login, budgeted twice over:
//
//   * per (address, email) — five attempts. A mistyped password is limited where
//     it belongs, and an office behind carrier-grade NAT is not locked out by
//     strangers sharing its apparent address.
//   * per address — thirty attempts, so spraying a list of emails from one place
//     still runs out.
//
// Both skip successful requests, so a working sign-in never eats the budget.
const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKey(req)}:${emailKey(req) || 'no-email'}`,
  message: { message: 'Too many login attempts. Please wait a few minutes and try again.' },
});

const loginSprayLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_SPRAY_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKey(req),
  message: { message: 'Too many login attempts from this connection. Please wait a few minutes.' },
});


// Public lookup limiter: defaults to 5 requests/minute per IP.
// Sends 429 with RateLimit/Retry-After headers on breach.
// The ID gate is a short number that is written on a card, so the rate limit is
// the thing standing between a script and the whole register — it stays tight.
const lookupLimiter = rateLimit({
  windowMs: Number(process.env.LOOKUP_RATE_LIMIT_WINDOW_MS) || 60000,
  max: Number(process.env.LOOKUP_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many lookups. Please wait a minute and try again.' },
});

// Group overview loads automatically on every page visit (not per search),
// so it needs a much more generous budget than the passbook lookup.
const overviewLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a minute and try again.' },
});

// The document vault, the minutes and the constitution are all ID-gated but
// browsed — a member unlocks once and then opens several things, so this is more
// generous than the passbook lookup while still capping scripted scraping of an
// ID, which is a short number and so worth capping.
const documentLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a minute and try again.' },
});

// Recording a decision on a chapter is the one write a member makes, and a member
// who is reading properly records two dozen of them in one sitting — far more
// requests per minute than a browse. Generous enough to finish the whole
// constitution on a phone, still capped so nobody can script bulk voting.
const constitutionDecisionLimiter = rateLimit({
  windowMs: 60000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many decisions at once. Please wait a minute and try again.' },
});

// A leaked/stolen JWT shouldn't get unlimited guesses at the current
// password — same budget as login since it's the same kind of attack.
const passwordChangeLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Too many attempts. Please wait a few minutes and try again.' },
});

// The authenticated API: a ceiling on volume rather than an attempt to stop
// nothing in particular. It exists so one runaway client (a retry loop, a script, a
// stolen token) cannot hammer the database, and it is keyed on the session rather
// than the address — an admin on a phone changes address mid-session, and the office
// behind carrier NAT should not have its own requests look like an attack.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return ipKey(req);
    // The token itself never becomes a key: a hash is enough to tell sessions
    // apart, and it keeps a live credential out of the limiter's memory.
    return `token:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
  },
  message: { message: 'Too many requests. Please slow down and try again in a minute.' },
});

module.exports = {
  loginLimiter,
  loginSprayLimiter,
  apiLimiter,
  lookupLimiter,
  overviewLimiter,
  documentLimiter,
  passwordChangeLimiter,
  constitutionDecisionLimiter,
};

