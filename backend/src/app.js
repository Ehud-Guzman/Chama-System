require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');

const connectDB = require('./config/db');
const { lookupLimiter, overviewLimiter, directoryLimiter } = require('./middleware/rateLimiter');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { publicLookup, publicDirectory, publicMemberProfile } = require('./controllers/memberController');
const { publicOverview } = require('./controllers/overviewController');

const authRoutes = require('./routes/authRoutes');
const memberRoutes = require('./routes/memberRoutes');
const contributionRoutes = require('./routes/contributionRoutes');
const reportRoutes = require('./routes/reportRoutes');
const typeRoutes = require('./routes/typeRoutes');
const settingsRoutes = require('./routes/settingsRoutes');

const app = express();

// Render/Railway sit behind a proxy — needed for correct per-IP rate limiting
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: false,
  })
);
app.use(express.json({ limit: '2mb' })); // CSV import arrives as JSON text
app.use(mongoSanitize());

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Public member lookup — rate-limited, exact match only
app.get('/api/public/lookup', lookupLimiter, publicLookup);
// Public group overview — chama name, membership size, totals by type
app.get('/api/public/overview', overviewLimiter, publicOverview);
// Public member directory — full openness by design; phone numbers are masked
app.get('/api/public/directory', directoryLimiter, publicDirectory);
app.get('/api/public/directory/:id', directoryLimiter, publicMemberProfile);

app.use('/api/auth', authRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/contributions', contributionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/types', typeRoutes);
app.use('/api/settings', settingsRoutes);

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
