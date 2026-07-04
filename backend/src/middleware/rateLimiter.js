const rateLimit = require('express-rate-limit');

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

module.exports = { lookupLimiter, overviewLimiter, directoryLimiter };
