const mongoose = require('mongoose');
const { logEvent } = require('../middleware/requestLogger');

// Watches for index build failures.
//
// Mongoose builds each model's indexes in the background after connecting, and a
// failure is reported through an event nobody listens to by default — which is how
// a *unique* index that could not be built (two members already sharing a national
// ID, say) looks exactly like a healthy start. This turns it into a log line.
function watchIndexBuilds() {
  for (const model of Object.values(mongoose.models)) {
    model.on('index', (err) => {
      if (!err) return;
      logEvent(
        'index_build_failed',
        {
          model: model.modelName,
          error: err.message,
          hint: 'A unique index that cannot be built means duplicates already exist. See `npm run check:national-ids`.',
        },
        'error'
      );
    });
  }
}

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  watchIndexBuilds();
  logEvent('mongo_connected', { db: mongoose.connection.name });
}

module.exports = connectDB;
