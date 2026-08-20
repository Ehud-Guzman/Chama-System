require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');

const connectDB = require('./config/db');
const { lookupLimiter, overviewLimiter, directoryLimiter } = require('./middleware/rateLimiter');
const { notFound, errorHandler } = require('./middleware/errorHandler');
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

// Render/Railway sit behind a proxy — needed for correct per-IP rate limiting
app.set('trust proxy', 1);

app.use(helmet());

// --- CORS -------------------------------------------------------------
// Supports multiple allowed origins via a comma-separated FRONTEND_URL env var,
// e.g. FRONTEND_URL="https://chama-contribution-manager.netlify.app,http://localhost:5173"
// Set credentials: true ONLY if you switch auth to cookie/session-based.
// If auth stays Bearer-token (JWT in Authorization header), leave it false.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (curl, Postman, mobile apps, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked: ${origin} not allowed`));
    },
    credentials: false, // set true only if switching to cookie-based auth
  })
);
// -----------------------------------------------------------------------

app.use(express.json({ limit: '2mb' })); // CSV import arrives as JSON text
app.use(mongoSanitize());

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Public member lookup — rate-limited, exact match only
app.get('/api/public/lookup', lookupLimiter, publicLookup);
app.get('/api/public/lookup/statement', lookupLimiter, publicLookupStatement);
app.get('/api/public/lookup/statement/excel', lookupLimiter, publicLookupStatementExcel);
app.get('/api/public/directory/:id/statement', directoryLimiter, publicMemberStatement);
app.get('/api/public/directory/:id/statement/excel', directoryLimiter, publicMemberStatementExcel);
// Public group overview — chama name, membership size, totals by type
app.get('/api/public/overview', overviewLimiter, publicOverview);
// Public member directory — full openness by design; phone numbers are masked
app.get('/api/public/directory', directoryLimiter, publicDirectory);
app.get('/api/public/directory/:id', directoryLimiter, publicMemberProfile);
// Public resigned-members list — same openness policy as the active directory
app.get('/api/public/resigned', directoryLimiter, publicResigned);

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

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('JWT_SECRET must be set and at least 32 characters long.');
    process.exit(1);
  }
  connectDB()
    .then(() => {
      app.listen(PORT, () => console.log(`API running on port ${PORT}`));
    })
    .catch((err) => {
      console.error('Failed to connect to MongoDB:', err.message);
      process.exit(1);
    });
}

module.exports = app;