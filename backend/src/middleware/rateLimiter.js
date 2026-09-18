const rateLimit = require('express-rate-limit');

// Admin login: the one endpoint actually worth brute-forcing. Tight budget,
// keyed by IP — deliberately stricter than every public read-only route.
const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Too many login attempts. Please wait a few minutes and try again.' },
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

module.exports = { loginLimiter, lookupLimiter, overviewLimiter, documentLimiter, passwordChangeLimiter, constitutionDecisionLimiter };
