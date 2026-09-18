require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');

const connectDB = require('./config/db');
const { seedDisciplinaryFineTypes } = require('./utils/seedDisciplinaryFineTypes');
const { seedLedgerTypes, seedGroupFunds } = require('./utils/ledgerTypes');
const { ensureDocumentCategories } = require('./utils/documentCategories');

const {
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
  res.status(200).json({
    ok: true,
    message: 'API is healthy',
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

// The chama's constitution — members only, by the same phone gate as the
// document vault below. There is deliberately no public directory of members:
// a member's record is theirs, and it is opened by proving his number, not by
// anybody browsing a list of names.
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
// records. Gated on a registered member's phone number: no number, no list.
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

// Public meeting minutes — phone-gated by the same rule as the document vault:
// enter a registered member's number, or see nothing.
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
  // JWT is required for the application to start.
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error(
      'JWT_SECRET must be set and at least 32 characters long.'
    );
    process.exit(1);
  }

  connectDB()
    .then(() => seedDisciplinaryFineTypes())
    .then(() => seedLedgerTypes())
    // The funds the group keeps: seeded so the go-live screen lists them all
    // without anybody typing ten fund names in.
    .then(() => seedGroupFunds())
    // The document vault's headings: seeded so a vault that has never been filed
    // in still offers the group's own six.
    .then(() => ensureDocumentCategories())
    .then(() => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`API running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error(
        'Failed to connect to MongoDB:',
        err.message
      );

      process.exit(1);
    });
}

module.exports = app;
