require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const mongoose = require('mongoose');

const connectDB = require('./config/db');
const { validateEnv } = require('./config/env');
const { requestLogger, logEvent } = require('./middleware/requestLogger');
const { seedDisciplinaryFineTypes } = require('./utils/seedDisciplinaryFineTypes');
const { seedLedgerTypes, seedGroupFunds } = require('./utils/ledgerTypes');
const { ensureDocumentCategories } = require('./utils/documentCategories');

const {
  apiLimiter,
  lookupLimiter,
  overviewLimiter,
  documentLimiter,
  constitutionDecisionLimiter,
} = require('./middleware/rateLimiter');

const {
  notFound,
  errorHandler,
} = require('./middleware/errorHandler');

const {
  publicLookup,
  publicLookupStatement,
  publicLookupStatementExcel,
} = require('./controllers/memberController');

const { publicOverview } = require('./controllers/overviewController');
const { publicConstitution, publicConstitutionDecision } = require('./controllers/constitutionController');

const {
  publicListDocuments,
  publicDocumentFile,
} = require('./controllers/documentController');

const {
  publicListMinutes,
  publicGetMinute,
} = require('./controllers/minuteController');

// Routes
const authRoutes = require('./routes/authRoutes');
const memberRoutes = require('./routes/memberRoutes');
const contributionRoutes = require('./routes/contributionRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');
const reportRoutes = require('./routes/reportRoutes');
const typeRoutes = require('./routes/typeRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const fineTypeRoutes = require('./routes/fineTypeRoutes');
const fineRoutes = require('./routes/fineRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const minuteRoutes = require('./routes/minuteRoutes');
const documentRoutes = require('./routes/documentRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const backupRoutes = require('./routes/backupRoutes');
const jobRoutes = require('./routes/jobRoutes');
const auditRoutes = require('./routes/auditRoutes');
const app = express();

// -----------------------------------------------------------------------------
// Proxy
// -----------------------------------------------------------------------------
// Render/Railway sit behind a proxy.
// Required for correct client IP detection and rate limiting.
app.set('trust proxy', 1);

// -----------------------------------------------------------------------------
// Security
// -----------------------------------------------------------------------------
app.use(helmet());

// Every response carries a request id, and every request leaves one line in the
// log. First, so a request that fails in the middleware below is still traceable.
app.use(requestLogger);

// JSON compresses by roughly 80%, and this API has two large payloads — the
// ledger (every member, every week) and the audit trail — both fetched on phones
// on mobile data. Images and PDFs are already compressed, so they pass through.
app.use(compression());

// -----------------------------------------------------------------------------
// CORS
// -----------------------------------------------------------------------------
// FRONTEND_URL is one origin or several separated by commas — the live domain, its
// www twin, and the site's own netlify.app address, so the app keeps working from
// whichever of them a member has open. A request with no Origin header at all (curl,
// a health check, a browser navigation) is not a cross-origin request and is let
// through.
const allowedOrigins = String(process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);

// The dev server is always allowed outside production, so a local checkout can talk
// to a deployed API without editing the host's environment.
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173');
}

app.use(
  cors({
    origin(origin, callback) {
      // No header on the response when the origin is not allowed: the browser then
      // refuses to hand the response to the page, which is what CORS is for.
      callback(null, !origin || allowedOrigins.includes(origin.replace(/\/+$/, '')));
    },
    credentials: false,
    exposedHeaders: ['Content-Disposition'],
  })
);

// -----------------------------------------------------------------------------
// Body parsing
// -----------------------------------------------------------------------------
app.use(express.json({ limit: '2mb' }));

// Prevent MongoDB operator injection
app.use(mongoSanitize());

// -----------------------------------------------------------------------------
// Health check
// -----------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  // A health check that does not check anything is worse than none: a load
  // balancer would keep sending traffic to an instance whose database is gone.
  const dbUp = mongoose.connection?.readyState === 1;
  res.status(dbUp ? 200 : 503).json({
    ok: dbUp,
    db: dbUp ? 'connected' : 'disconnected',
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// -----------------------------------------------------------------------------
// PUBLIC API
// -----------------------------------------------------------------------------

// Public member lookup
app.get(
  '/api/public/lookup',
  lookupLimiter,
  publicLookup
);

app.get(
  '/api/public/lookup/statement',
  lookupLimiter,
  publicLookupStatement
);

app.get(
  '/api/public/lookup/statement/excel',
  lookupLimiter,
  publicLookupStatementExcel
);

// Public group overview — totals only, never a member's name or balance.
app.get(
  '/api/public/overview',
  overviewLimiter,
  publicOverview
);

// The chama's constitution — members only, by the same ID gate as the document
// vault below. There is deliberately no public directory of members: a member's
// record is theirs, and it is opened by proving his ID, not by anybody browsing a
// list of names.
app.get(
  '/api/public/constitution',
  documentLimiter,
  publicConstitution
);

// A member recording his own verdict on a chapter — the one write a member makes.
app.post(
  '/api/public/constitution/decision',
  constitutionDecisionLimiter,
  publicConstitutionDecision
);

// Public chama documents — the group's title deeds, certificates and other
// records. Gated on the ID on a registered member's record: no ID, no list.
app.get(
  '/api/public/documents',
  documentLimiter,
  publicListDocuments
);

app.get(
  '/api/public/documents/:id/file',
  documentLimiter,
  publicDocumentFile
);

// Public meeting minutes — ID-gated by the same rule as the document vault:
// enter the ID on a registered member's record, or see nothing.
app.get(
  '/api/public/minutes',
  documentLimiter,
  publicListMinutes
);

app.get(
  '/api/public/minutes/:id',
  documentLimiter,
  publicGetMinute
);

// -----------------------------------------------------------------------------
// ADMIN / AUTHENTICATED API
// -----------------------------------------------------------------------------
//
// Everything below the public block is authenticated, so it is also where the
// volume ceiling goes: a runaway retry loop or a stolen token gets 300 requests a
// minute, keyed on the session rather than the address (see middleware/rateLimiter).
// Declared after the public routes so it never touches them — a matched public
// route has already ended its chain by the time this is reached.
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);

app.use('/api/members', memberRoutes);

app.use('/api/contributions', contributionRoutes);

// The treasurer's ledger — member list, per-member logs, week cycle setup
app.use('/api/ledger', ledgerRoutes);

app.use('/api/reports', reportRoutes);

app.use('/api/types', typeRoutes);

app.use('/api/settings', settingsRoutes);

app.use('/api/fine-types', fineTypeRoutes);

app.use('/api/fines', fineRoutes);

app.use('/api/expenses', expenseRoutes);

app.use('/api/minutes', minuteRoutes);

app.use('/api/documents', documentRoutes);

app.use('/api/uploads', uploadRoutes);

// Late-contribution / fine reminder emails
app.use('/api/notifications', notificationRoutes);

app.use('/api/backup', backupRoutes);

// The scheduled jobs: what they are, when they run next, and a way to run one by hand.
app.use('/api/jobs', jobRoutes);

// The audit trail: who changed what, when, and which of it was out of the ordinary.
app.use('/api/audit', auditRoutes);

// -----------------------------------------------------------------------------
// Error handling
// -----------------------------------------------------------------------------

app.use(notFound);

app.use(errorHandler);

// -----------------------------------------------------------------------------
// Server
// -----------------------------------------------------------------------------

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  // Configuration is checked before anything else happens, so a deploy that is
  // missing a variable fails loudly at boot rather than quietly in production.
  validateEnv();

  let server = null;
  let shuttingDown = false;

  const boot = connectDB()
    .then(() => seedDisciplinaryFineTypes())
    .then(() => seedLedgerTypes())
    // The funds the group keeps: seeded so the go-live screen lists them all
    // without anybody typing ten fund names in.
    .then(() => seedGroupFunds())
    // The document vault's headings: seeded so a vault that has never been filed
    // in still offers the group's own six.
    .then(() => ensureDocumentCategories())
    // The scheduled work: the nightly backup, the weekly audit check and the reminder sweep.
    // Started last, after the seeds, so a job can never run against a half-initialised database.
    .then(() => {
      if (String(process.env.JOBS_ENABLED || 'true').toLowerCase() !== 'false') {
        // Required lazily so the test suite — which never boots a server — does not pull the
        // jobs, the models behind them, or their schedules into the process at all.
        const { startJobs } = require('./jobs');
        startJobs();
      }
    })
    .then(() => {
      server = app.listen(PORT, '0.0.0.0', () => {
        logEvent('api_started', {
          port: PORT,
          node: process.version,
          env: process.env.NODE_ENV || 'development',
        });
      });
      return server;
    });

  // Graceful shutdown. The host sends SIGTERM on every deploy and expects the
  // process to finish what it is holding: a bulk week collection writes dozens of
  // documents, and cutting it off mid-run leaves the treasurer looking at a half
  // posted week (the per-row keys make a re-run safe, but nothing tells them a
  // re-run is needed). In-flight requests get fifteen seconds, then the process
  // goes anyway — an instance that will not die is worse than one that dies.
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logEvent('shutdown_started', { signal });

    const timer = setTimeout(() => {
      logEvent('shutdown_forced', { signal, afterSeconds: 15 }, 'warn');
      process.exit(1);
    }, 15000);
    timer.unref?.();

    try {
      // The scheduled jobs stop first: a nightly backup that starts during a deploy would be
      // killed half-written, and a half-written backup file is worse than none — it looks like
      // a backup and cannot be restored.
      try {
        const { stopJobs } = require('./jobs');
        stopJobs();
      } catch {
        // The jobs module was never loaded (JOBS_ENABLED=false, or a failed boot).
      }

      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
      await mongoose.disconnect();
      clearTimeout(timer);
      logEvent('shutdown_complete', { signal });
      process.exit(0);
    } catch (err) {
      logEvent('shutdown_failed', { signal, error: err.message }, 'error');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // A promise that rejects outside a route (a timer, a fire-and-forget write) has
  // nowhere to return its error. Log it with enough context to act on, then let
  // the platform restart a clean process.
  process.on('unhandledRejection', (reason) => {
    logEvent(
      'unhandled_rejection',
      { error: reason instanceof Error ? reason.message : String(reason) },
      'error'
    );
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    logEvent(
      'uncaught_exception',
      { error: err.message, stack: String(err.stack || '').split('\n').slice(0, 4).join(' | ') },
      'error'
    );
    process.exit(1);
  });

  boot.catch((err) => {
    logEvent('startup_failed', { error: err.message }, 'error');
    process.exit(1);
  });
}

module.exports = app;
