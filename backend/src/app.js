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
const { backfillDeactivatedAt } = require('./utils/backfillDeactivatedAt');
const { backfillLastActive } = require('./utils/backfillLastActive');
const { recordServerError } = require('./utils/serverErrors');
const { maintenanceGuard } = require('./middleware/maintenance');
const { membersAreaOpen } = require('./middleware/membersArea');

const {
  apiLimiter,
  gateGuard,
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
  unlockRecords,
  publicLookupStatement,
  publicLookupStatementExcel,
} = require('./controllers/memberController');
const { requireMember } = require('./utils/memberToken');

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
const superAdminRoutes = require('./routes/superAdminRoutes');
const { tick } = require('./controllers/jobController');
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

// Everything under /api/public that carries a member's data is never stored by a browser, a
// shared phone's cache or a proxy. Only the group overview — public totals, the same for everyone —
// may be.
app.use('/api/public', (req, res, next) => {
  if (req.path !== '/overview') res.setHeader('Cache-Control', 'no-store');
  next();
});

// The super admin can close the members' area (Control Room → Switches). The group's totals on the
// front page are not behind it: the page still loads, and says why.
app.use('/api/public', (req, res, next) => {
  if (req.path === '/overview') return next();
  return membersAreaOpen(req, res, next);
});

// A member's verdict on a chapter is a write, so it stops in maintenance mode like every other one.
app.use('/api/public/constitution/decision', maintenanceGuard);

// The members' gate: the two places an ID number is spent. POST, so the number and the phone travel
// in the body and not in a URL that history and logs keep; behind the gate guard (four limits, see
// middleware/rateLimiter). Each hands back a pass (utils/memberToken); the rest of the members' area
// asks for that, never the number.
app.post(
  '/api/public/lookup',
  gateGuard,
  publicLookup
);

app.post(
  '/api/public/records/unlock',
  gateGuard,
  unlockRecords
);

// The passbook's own statements: his money, so they need the kind of pass the lookup gives (phone
// proved too, whenever the group asks for it).
app.get(
  '/api/public/lookup/statement',
  documentLimiter,
  requireMember({ passbook: true }),
  publicLookupStatement
);

app.get(
  '/api/public/lookup/statement/excel',
  documentLimiter,
  requireMember({ passbook: true }),
  publicLookupStatementExcel
);

// Public group overview — totals only, never a member's name or balance.
app.get(
  '/api/public/overview',
  overviewLimiter,
  publicOverview
);

// The chama's constitution — members only, by the same member pass as the document
// vault below. There is deliberately no public directory of members: a member's
// record is theirs, and it is opened by proving his ID, not by anybody browsing a
// list of names.
app.get(
  '/api/public/constitution',
  documentLimiter,
  requireMember(),
  publicConstitution
);

// A member recording his own verdict on a chapter — the one write a member makes.
app.post(
  '/api/public/constitution/decision',
  constitutionDecisionLimiter,
  requireMember(),
  publicConstitutionDecision
);

// Public chama documents — the group's title deeds, certificates and other
// records. Gated on the ID on a registered member's record: no ID, no list.
app.get(
  '/api/public/documents',
  documentLimiter,
  requireMember(),
  publicListDocuments
);

app.get(
  '/api/public/documents/:id/file',
  documentLimiter,
  requireMember(),
  publicDocumentFile
);

// Public meeting minutes — behind the same member pass as the document vault:
// prove the ID on a registered member's record at the gate, or see nothing.
app.get(
  '/api/public/minutes',
  documentLimiter,
  requireMember(),
  publicListMinutes
);

app.get(
  '/api/public/minutes/:id',
  documentLimiter,
  requireMember(),
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

// An outside pinger's way to run the jobs a sleeping host missed. Secret-protected, and absent
// unless JOBS_CRON_TOKEN is set.
app.get('/api/cron/tick', tick);

// Maintenance mode: reads still work, writes stop for everyone but the super admin.
app.use('/api', maintenanceGuard);

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

// The Control Room: oversight and override tools, super admin only.
app.use('/api/superadmin', superAdminRoutes);

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
    // Members made inactive before the day was recorded get it now, from the audit trail, so their accounting
    // stops on the day they left and does not drift with every later edit of their record. Idempotent, fills
    // only what is missing, and never lets a failure stop the server starting.
    .then(() =>
      backfillDeactivatedAt()
        .then((result) => {
          if (result.filled.length > 0) logEvent('deactivated_at_backfilled', { count: result.filled.length });
        })
        .catch((err) => logEvent('deactivated_at_backfill_failed', { error: err.message }, 'error'))
    )
    // Accounts in use before sign-ins were recorded get a "last seen" from the audit trail, so the
    // Control Room does not call a daily user "no sign-in recorded". Idempotent, never fatal.
    .then(() =>
      backfillLastActive()
        .then((result) => {
          if (result.filled.length > 0) logEvent('last_active_backfilled', { count: result.filled.length });
        })
        .catch((err) => logEvent('last_active_backfill_failed', { error: err.message }, 'error'))
    )
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
  // Recorded (and the super admin emailed) before the process goes, but never for longer than three
  // seconds: a crash that waits on a database that is the thing that failed would never exit.
  const recordThenExit = (err, kind) =>
    Promise.race([recordServerError({ err, kind }), new Promise((resolve) => setTimeout(resolve, 3000))]).finally(() =>
      process.exit(1)
    );

  process.on('unhandledRejection', (reason) => {
    logEvent(
      'unhandled_rejection',
      { error: reason instanceof Error ? reason.message : String(reason) },
      'error'
    );
    recordThenExit(reason instanceof Error ? reason : new Error(String(reason)), 'unhandled_rejection');
  });
  process.on('uncaughtException', (err) => {
    logEvent(
      'uncaught_exception',
      { error: err.message, stack: String(err.stack || '').split('\n').slice(0, 4).join(' | ') },
      'error'
    );
    recordThenExit(err, 'uncaught_exception');
  });

  boot.catch((err) => {
    logEvent('startup_failed', { error: err.message }, 'error');
    process.exit(1);
  });
}

module.exports = app;
