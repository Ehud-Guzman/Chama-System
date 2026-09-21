// Searching the minutes.
//
// A word said in a meeting has to be findable wherever it was said — in the title,
// in the agenda, in a decision three paragraphs down — so a search reads the whole
// minute rather than the preview a list happens to show. That is the difference
// between this and a filter over what is already on screen: the minute somebody
// wants is usually the one from months back, which is not loaded at all.
//
// The candidates come from Mongo: a regular expression over the stored HTML, on the
// title and on the body, capped and newest first. What a regular expression over
// HTML cannot do is tell a word from a tag — `li`, `strong`, `href` and the URL
// inside a link are all "in" the document to a regex, and none of them is something
// anybody said — so every candidate is checked again here against the minute's
// *text*, and one that matched only its own markup is dropped instead of being
// returned as a result with nothing on the screen to explain it.
//
// Kept out of the controller so the whole rule can be tested without a database:
// what is searched, what counts as a match, and what a result shows.
const { DAY_MS } = require('./weekCycle');

// The ceiling on documents *scanned* for one search, not on what a screen shows.
// A meeting word is not a needle in a haystack: an office that has been keeping
// minutes for years still has hundreds, not millions, so a hundred newest candidates
// covers the realistic answer while keeping one search to one bounded query.
const MAX_SEARCH_RESULTS = 100;

// How much of the sentence around the word a result shows.
const SNIPPET_RADIUS = 90;

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Blocks end where words end, so they become a space; the marks inside a line
// (bold, italic, a link) vanish without splitting a word in half — `Min
// <strong>12</strong>/2026` is one word to a reader, and so it stays to a search.
const BLOCK_TAGS = /<\/?(p|h[1-6]|ul|ol|li|blockquote|pre|hr|br|div)[^>]*>/gi;

// The named characters the editor's own output can contain, plus the numeric
// escapes a paste can bring with it. Anything unrecognised is left exactly as it
// was written rather than being turned into something the group never said.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function entityText(code) {
  if (code[0] === '#') {
    const hex = code[1] === 'x' || code[1] === 'X';
    const value = Number.parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10);
    if (Number.isFinite(value) && value > 0 && value <= 0x10ffff) return String.fromCodePoint(value);
    return `&${code};`;
  }
  return NAMED_ENTITIES[code.toLowerCase()] ?? `&${code};`;
}

// The words of a minute, without its markup: one line, single-spaced, entities
// resolved — what the page shows and therefore what a reader searches for.
function plainTextOf(html) {
  return String(html ?? '')
    .replace(BLOCK_TAGS, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => entityText(code))
    .replace(/\s+/g, ' ')
    .trim();
}

// The term as a database condition, or null when there is nothing to search for.
// Escaped: somebody may search `1,400` or `(chairman)` and mean the characters,
// not a pattern.
function bodyCondition(term) {
  const text = String(term ?? '').trim();
  if (!text) return null;
  const rx = new RegExp(escapeRegex(text), 'i');
  return [{ title: rx }, { content: rx }];
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
//
// Typing a date is one way of asking for that meeting, so a term that reads as one
// searches the date alongside the words. Minutes store the day the office typed —
// a bare 'YYYY-MM-DD', which is UTC midnight — so these boundaries are UTC too.
// (The ledger's days are EAT days because money arrives at an hour; a minute's date
// is a square on the calendar.)
const YEAR_ONLY = /^(19|20)\d{2}$/;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const WRITTEN_DATE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;

function dayRange(year, month, day) {
  const start = Date.UTC(year, month - 1, day);
  const asDate = new Date(start);
  // A day that does not exist — 31/02 — must match nothing rather than roll over
  // into March and hand back a meeting nobody asked for.
  if (
    asDate.getUTCFullYear() !== year ||
    asDate.getUTCMonth() !== month - 1 ||
    asDate.getUTCDate() !== day
  ) {
    return null;
  }
  return { from: new Date(start), to: new Date(start + DAY_MS) };
}

// The half-open range of instants a date-like term covers, or null when the term is
// not a date at all — in which case it is only ever a word, and words are searched
// as text.
function dateRangeForTerm(term) {
  const text = String(term ?? '').trim();

  if (YEAR_ONLY.test(text)) {
    const year = Number(text);
    return { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year + 1, 0, 1)) };
  }

  const iso = ISO_DATE.exec(text);
  if (iso) return dayRange(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // 21/05/2026, 21-05-2026 and 21.5.26 — the ways a Kenyan office writes a date.
  const written = WRITTEN_DATE.exec(text);
  if (written) {
    const year = Number(written[3]) < 100 ? 2000 + Number(written[3]) : Number(written[3]);
    return dayRange(year, Number(written[2]), Number(written[1]));
  }

  return null;
}

function dateMatchesTerm(date, term) {
  const range = dateRangeForTerm(term);
  if (!range) return false;
  const at = new Date(date).getTime();
  return at >= range.from.getTime() && at < range.to.getTime();
}

// The conditions a search adds to a base filter, or null when there is no term to
// search for: an empty box is a browse, not a search for nothing.
function minuteSearchConditions(term) {
  const conditions = bodyCondition(term);
  if (!conditions) return null;

  const range = dateRangeForTerm(term);
  if (range) conditions.push({ date: { $gte: range.from, $lt: range.to } });

  return conditions;
}

// The words around the first hit, with ellipses where the sentence was cut — so a
// result says *why* it is a result instead of making the reader hunt for the word.
function snippetAround(text, term, radius = SNIPPET_RADIUS) {
  const haystack = String(text ?? '');
  const needle = String(term ?? '').trim();
  if (!needle) return null;

  const at = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return null;

  const from = Math.max(0, at - radius);
  const to = Math.min(haystack.length, at + needle.length + radius);
  const before = from > 0 ? '…' : '';
  const after = to < haystack.length ? '…' : '';
  return `${before}${haystack.slice(from, to).trim()}${after}`;
}

// Where the term genuinely appears in a minute, or null when the database's hit was
// on the markup. `field` says which part answered, which is what lets a result show
// the sentence for a body hit and simply highlight the title (or the date it already
// prints) for the other two.
function explainMatch(minute, term) {
  const text = String(term ?? '').trim();
  if (!text) return null;

  const snippet = snippetAround(plainTextOf(minute?.content), text);
  if (snippet) return { field: 'content', snippet };

  const title = plainTextOf(minute?.title);
  if (title.toLowerCase().includes(text.toLowerCase())) return { field: 'title', snippet: '' };

  if (dateMatchesTerm(minute?.date, text)) return { field: 'date', snippet: '' };

  return null;
}

module.exports = {
  MAX_SEARCH_RESULTS,
  SNIPPET_RADIUS,
  escapeRegex,
  plainTextOf,
  minuteSearchConditions,
  snippetAround,
  dateRangeForTerm,
  dateMatchesTerm,
  explainMatch,
};
