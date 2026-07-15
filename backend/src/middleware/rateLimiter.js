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
const lookupLimiter = rateLimit({
  windowMs: Number(process.env.LOOKUP_RATE_LIMIT_WINDOW_MS) || 60000,
  max: Number(process.env.LOOKUP_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many lookups. Please wait a minute and try again.' },
});

// Group overview loads automatically on every page visit (not per search),
// so it needs a much more generous budget than the phone lookup.
const overviewLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a minute and try again.' },
});

// The member directory is meant to be freely browsed — the group chose full
// openness over privacy-by-obscurity — so this only guards against raw abuse,
// not against people genuinely paging through the whole list.
const directoryLimiter = rateLimit({
  windowMs: 60000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a minute and try again.' },
});

module.exports = { loginLimiter, lookupLimiter, overviewLimiter, directoryLimiter };
