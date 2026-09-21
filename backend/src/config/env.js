// Environment validation, run once at boot.
//
// The two variables whose absence used to fail *silently* are checked here, and a
// missing one stops the process with a message an operator can act on:
//
//   JWT_SECRET   — without it the API cannot sign or verify a session.
//   FRONTEND_URL — the CORS allow-list. With it unset the app fell back to
//                  http://localhost:5173, so every request from the live site was
//                  refused and the site looked completely broken while the API
//                  reported itself healthy. That is a deploy-time footgun, not a
//                  runtime condition, so it fails at deploy time.
function fail(message) {
  console.error(`\n  Configuration error: ${message}\n`);
  process.exit(1);
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function validateEnv() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    fail('JWT_SECRET must be set and at least 32 characters long.');
  }

  if (!process.env.MONGO_URI) {
    fail('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
  }

  if (isProduction() && !process.env.FRONTEND_URL) {
    fail(
      'FRONTEND_URL is not set. It is the CORS allow-list, so without it every '
        + 'request from the live site is refused. List the site\'s own addresses, '
        + 'comma-separated, e.g. https://example.co.ke,https://www.example.co.ke'
    );
  }

  const origins = String(process.env.FRONTEND_URL || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  for (const origin of origins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
      fail(
        `FRONTEND_URL entry "${origin}" is not an origin. It must be a scheme, a host `
          + 'and no trailing slash — the browser compares it character for character.'
      );
    }
  }

  if (isProduction()) {
    if (origins.includes('http://localhost:5173')) {
      console.warn(
        '  Warning: FRONTEND_URL still lists http://localhost:5173 in production.'
      );
    }
    if (!process.env.MAIL_FROM || (!process.env.SMTP_HOST && !process.env.MAIL_API_KEY)) {
      console.warn(
        '  Warning: no mail configuration (SMTP_HOST, or MAIL_API_KEY with '
          + 'MAIL_API_PROVIDER, plus MAIL_FROM), so reminder emails will report '
          + 'themselves as not configured.'
      );
    }
    if (!process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_CLOUD_NAME) {
      console.warn(
        '  Warning: no Cloudinary credentials, so photo and logo uploads are switched off.'
      );
    }
  }
}

module.exports = { validateEnv, isProduction };
