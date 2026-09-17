require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');

const connectDB = require('./config/db');
const { seedDisciplinaryFineTypes } = require('./utils/seedDisciplinaryFineTypes');
const { seedLedgerTypes } = require('./utils/ledgerTypes');

const {
  lookupLimiter,
  overviewLimiter,
  directoryLimiter,
  documentLimiter,
} = require('./middleware/rateLimiter');

const {
  notFound,
  errorHandler,
} = require('./middleware/errorHandler');

const {
  publicLookup,
  publicLookupStatement,
  publicLookupStatementExcel,
  publicDirectory,
  publicMemberProfile,
  publicMemberStatement,
  publicMemberStatementExcel,
  publicResigned,
} = require('./controllers/memberController');

const { publicOverview } = require('./controllers/overviewController');

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

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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

// Public group overview
app.get(
  '/api/public/overview',
  overviewLimiter,
  publicOverview
);

// Public member directory
app.get(
  '/api/public/directory',
  directoryLimiter,
  publicDirectory
);

app.get(
  '/api/public/directory/:id',
  directoryLimiter,
  publicMemberProfile
);

app.get(
  '/api/public/directory/:id/statement',
  directoryLimiter,
  publicMemberStatement
);

app.get(
  '/api/public/directory/:id/statement/excel',
  directoryLimiter,
  publicMemberStatementExcel
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

// Public resigned members
app.get(
  '/api/public/resigned',
  directoryLimiter,
  publicResigned
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
