const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { DatabaseStore } = require('./rateLimitStore');
const { nationalIdFingerprint } = require('../utils/nationalId');

// The limits that guard a credential keep their counts in the database (middleware/rateLimitStore),
// so a restart or a deploy does not hand an attacker a fresh set of tries. The rest stay in memory.
const durable = (prefix) => new DatabaseStore({ prefix });

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
  store: durable('login'),
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKey(req)}:${emailKey(req) || 'no-email'}`,
  message: { message: 'Too many login attempts. Please wait a few minutes and try again.' },
});

const loginSprayLimiter = rateLimit({
  store: durable('login-spray'),
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_SPRAY_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKey(req),
  message: { message: 'Too many login attempts from this connection. Please wait a few minutes.' },
});


// The members' gate: the passbook lookup and the records unlock, the two places an ID number is
// spent. Four limits stand in front of them, and the reason there are four is that each one closes
// a way round the others:
//
//   * a per-address ceiling on volume, successful or not, in memory — a runaway client, not an
//     attacker;
//   * per address, FAILURES only — twenty in a quarter of an hour. A script walking through ID
//     numbers runs out here; an office or a mobile carrier's shared address does not, because the
//     members behind it succeed far more often than they fail;
//   * per (address, ID), failures only — a member who mistypes his own number a few times is stopped
//     from hammering it, and nobody else on his connection is touched;
//   * per ID, failures only, from ANY address — the one that matters most with the phone check on.
//     The phone number is the thing being guessed then, and without this a stranger with an ID card
//     and a few hundred addresses (an IPv6 /64 is enough, and is only counted as one here) could try
//     them in parallel for as long as he liked. The cost is that someone can lock a member out of
//     his passbook for a quarter of an hour by getting his own ID wrong on purpose; a short lock the
//     owner can wait out is a better trade than a number that can be ground down.
//
// Successful requests are not counted against the failure limits, so a member who opens his passbook
// and then downloads two statements has used none of his budget — the old single limit of five
// requests a minute counted all three and shared them with everyone on his address.
//
// The statements and the records themselves no longer take an ID at all (utils/memberToken), so
// there is nothing on them to guess and they only need a volume ceiling.
//
// Keys are fingerprints, never the number: a limiter row is a copy of whatever it is keyed on.
const GATE_WINDOW_MS = Number(process.env.GATE_WINDOW_MS) || 15 * 60 * 1000;

function gateFingerprint(req) {
  return nationalIdFingerprint(req.body && req.body.nationalId);
}

const publicCeiling = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.PUBLIC_CEILING_MAX) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKey(req),
  message: { message: 'Too many requests. Please wait a minute and try again.' },
});

const gateMessage = { message: 'Too many tries. Please wait a few minutes and try again.' };

const gateSprayLimiter = rateLimit({
  store: durable('gate-spray'),
  windowMs: GATE_WINDOW_MS,
  max: Number(process.env.GATE_SPRAY_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKey(req),
  message: gateMessage,
});

const gateAttemptLimiter = rateLimit({
  store: durable('gate-attempt'),
  windowMs: GATE_WINDOW_MS,
  max: Number(process.env.GATE_ATTEMPT_MAX) || 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Something that is not an ID is turned away before the register is touched and is the spray
  // limit's business; it must not share one bucket between everybody who typed rubbish.
  skip: (req) => !gateFingerprint(req),
  keyGenerator: (req) => `${ipKey(req)}:${gateFingerprint(req)}`,
  message: gateMessage,
});

const gateTargetLimiter = rateLimit({
  store: durable('gate-target'),
  windowMs: GATE_WINDOW_MS,
  max: Number(process.env.GATE_TARGET_MAX) || 15,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) => !gateFingerprint(req),
  keyGenerator: (req) => `id:${gateFingerprint(req)}`,
  message: gateMessage,
});

// In the order they should run: the cheap in-memory ceiling first.
const gateGuard = [publicCeiling, gateSprayLimiter, gateAttemptLimiter, gateTargetLimiter];

// Group overview loads automatically on every page visit (not per search),
// so it needs a much more generous budget than the passbook lookup.
const overviewLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKey(req),
  message: { message: 'Too many requests. Please wait a minute and try again.' },
});

// The document vault, the minutes and the constitution are browsed — a member unlocks once
// (the gate above) and then opens several things with the pass that earned him, so this is a
// ceiling on volume and scraping, not a guard on the ID: those routes no longer take one.
const documentLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKey(req),
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
  keyGenerator: (req) => ipKey(req),
  message: { message: 'Too many decisions at once. Please wait a minute and try again.' },
});

// A leaked/stolen JWT shouldn't get unlimited guesses at the current
// password — same budget as login since it's the same kind of attack.
// Asking for a password-reset email. Budgeted per address and email, and per connection, like sign-in:
// the endpoint answers the same whether or not the account exists, so the limit is what stops it
// being used to flood somebody's inbox or to probe for accounts.
const passwordResetLimiter = rateLimit({
  store: durable('password-reset'),
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.PASSWORD_RESET_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKey(req)}:${emailKey(req) || 'no-email'}`,
  message: { message: 'Too many reset requests. Please wait a few minutes and try again.' },
});

const passwordResetSprayLimiter = rateLimit({
  store: durable('password-reset-spray'),
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_SPRAY_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKey(req),
  message: { message: 'Too many reset requests from this connection. Please wait a few minutes.' },
});

const passwordChangeLimiter = rateLimit({
  store: durable('password-change'),
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Too many attempts. Please wait a few minutes and try again.' },
});

// The second factor, budgeted twice over like the password is.
//
// A six-digit code is a million possibilities, and one slot of slack either side means
// three of them are live at any moment — so ten tries is already one in thirty-three
// thousand against a single thirty-second window, and the code changes before a script
// could get through a meaningful fraction of the budget.
//
// Keyed on the challenge rather than only the address, and the challenge is hashed: the
// token is a live credential for the next five minutes, so it must not be kept in the
// limiter's memory in the clear (which is the same rule the API limiter follows for a
// session token). Budgeting per challenge also means one admin fat-fingering his own
// code cannot use up another admin's budget from the same office connection.
function challengeKey(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

const twoFactorLimiter = rateLimit({
  store: durable('two-factor'),
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.TWO_FACTOR_RATE_LIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKey(req)}:${challengeKey(req.body?.challenge)}`,
  message: { message: 'Too many code attempts. Please wait a few minutes and try again.' },
});

const twoFactorSprayLimiter = rateLimit({
  store: durable('two-factor-spray'),
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_SPRAY_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKey(req),
  message: { message: 'Too many attempts from this connection. Please wait a few minutes.' },
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
  twoFactorLimiter,
  twoFactorSprayLimiter,
  apiLimiter,
  gateGuard,
  gateFingerprint,
  ipKey,
  overviewLimiter,
  documentLimiter,
  passwordChangeLimiter,
  passwordResetLimiter,
  passwordResetSprayLimiter,
  constitutionDecisionLimiter,
};

