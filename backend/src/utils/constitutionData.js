const ConstitutionText = require('../models/ConstitutionText');
const { logEvent } = require('../middleware/requestLogger');

// Where the constitution's text comes from.
//
// The published edition used to live only in src/data/constitution.js — a file in
// the repository, which is a strange place for the one document the API gates
// behind a member's ID. It is now a row in the database, and this module is the
// single reader:
//
//   * `ConstitutionText` wins when it exists (see `npm run seed:constitution`,
//     which copies the file in and is how a deployment moves the text out of git).
//   * The bundled file is the fallback, so a fresh clone and the first deploy
//     still work exactly as before.
//
// A minute-long cache keeps the row off every page view. The constitution changes
// once a year, if that, and `invalidateConstitution()` is called by the seeder.
const CACHE_MS = 60 * 1000;
let cache = null;
let cacheAt = 0;
let warnedAboutFallback = false;

// The file that ships with the code, loaded lazily and tolerantly: once the text
// has been seeded into the database the file is *meant* to be deleted, and a
// missing file must not stop the API booting.
function bundledConstitution() {
  try {
    // eslint-disable-next-line global-require
    const data = require('../data/constitution');
    return { meta: data.constitutionMeta, chapters: data.constitutionChapters };
  } catch {
    return {
      meta: { eyebrow: '', title: 'Constitution', description: '', badges: [] },
      chapters: [],
    };
  }
}

async function loadConstitution() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;

  let row = null;
  try {
    row = await ConstitutionText.findOne({ key: 'main' }).lean();
  } catch (err) {
    // A database hiccup must not take the constitution down with it: the file is
    // still the published text until somebody overwrites the row.
    logEvent('constitution_read_failed', { error: err.message }, 'error');
  }

  if (row && Array.isArray(row.chapters) && row.chapters.length > 0) {
    cache = { meta: row.meta, chapters: row.chapters, source: 'database' };
  } else {
    if (!warnedAboutFallback && process.env.NODE_ENV === 'production') {
      warnedAboutFallback = true;
      logEvent('constitution_source', {
        source: 'bundled-file',
        note: 'Text is being served from src/data/constitution.js. Run `npm run seed:constitution` and then delete that file to take the members-only document out of the repository.',
      });
    }
    cache = { ...bundledConstitution(), source: 'bundled-file' };
  }

  cacheAt = Date.now();
  return cache;
}

function invalidateConstitution() {
  cache = null;
  cacheAt = 0;
}

module.exports = { loadConstitution, bundledConstitution, invalidateConstitution };
