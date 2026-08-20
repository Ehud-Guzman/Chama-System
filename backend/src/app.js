require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');

const connectDB = require('./config/db');

const {
  lookupLimiter,
  overviewLimiter,
  directoryLimiter,
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

// Routes
const authRoutes = require('./routes/authRoutes');
const memberRoutes = require('./routes/memberRoutes');
const contributionRoutes = require('./routes/contributionRoutes');
const reportRoutes = require('./routes/reportRoutes');
const typeRoutes = require('./routes/typeRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const fineTypeRoutes = require('./routes/fineTypeRoutes');
const fineRoutes = require('./routes/fineRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const minuteRoutes = require('./routes/minuteRoutes');

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

app.use('/api/reports', reportRoutes);

app.use('/api/types', typeRoutes);

app.use('/api/settings', settingsRoutes);

app.use('/api/fine-types', fineTypeRoutes);

app.use('/api/fines', fineRoutes);

app.use('/api/expenses', expenseRoutes);

app.use('/api/minutes', minuteRoutes);

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