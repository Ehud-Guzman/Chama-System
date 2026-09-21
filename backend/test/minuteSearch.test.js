// Searching the minutes, as a rule rather than as a screen.
//
// The two things worth pinning down are what counts as a word and what does not.
// A minute is stored as HTML, so a naive search over it finds `li`, `strong` and
// the URL inside a link — none of which anybody said in a meeting — while missing
// a word the editor split across a <strong> tag. Both directions are tested here.
//
// Pure: no database.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_SEARCH_RESULTS,
  plainTextOf,
  minuteSearchConditions,
  snippetAround,
  dateRangeForTerm,
  dateMatchesTerm,
  explainMatch,
} = require('../src/utils/minuteSearch');

const minute = (fields) => ({ date: new Date('2026-05-21T00:00:00.000Z'), ...fields });

test('a minute reads as the words on the page, not as its markup', () => {
  assert.equal(
    plainTextOf('<h2>Min 12/2026</h2><p>The chairman opened at <strong>7:05pm</strong>.</p>'),
    'Min 12/2026 The chairman opened at 7:05pm.'
  );

  // A block ends where a word ends, so two paragraphs never glue together…
  assert.equal(plainTextOf('<p>Arrears</p><p>Tea</p>'), 'Arrears Tea');
  assert.equal(plainTextOf('<ul><li>Fines</li><li>Pledges</li></ul>'), 'Fines Pledges');

  // …but a mark inside a word does not split it: to a reader this is one word, and
  // so it stays one word to a search.
  assert.equal(plainTextOf('<p>Min <strong>12</strong>/2026</p>'), 'Min 12/2026');

  // What a paste can bring with it, resolved to the character it stands for.
  assert.equal(plainTextOf('<p>Tea &amp; snacks</p>'), 'Tea & snacks');
  assert.equal(plainTextOf('<p>1,400 &#8212; paid</p>'), '1,400 — paid');
  // An entity nobody defined stays as it was written rather than becoming a guess.
  assert.equal(plainTextOf('<p>&notarealentity; paid</p>'), '&notarealentity; paid');

  assert.equal(plainTextOf(''), '');
  assert.equal(plainTextOf(null), '');
});

test('an empty box is a browse, not a search for nothing', () => {
  assert.equal(minuteSearchConditions(''), null);
  assert.equal(minuteSearchConditions('   '), null);
  assert.equal(minuteSearchConditions(undefined), null);
  assert.ok(MAX_SEARCH_RESULTS > 0);
});

test('a term becomes a title-or-body condition, escaped', () => {
  const conditions = minuteSearchConditions('fertilizer');
  assert.equal(conditions.length, 2);
  assert.ok(conditions[0].title instanceof RegExp);
  assert.ok(conditions[1].content instanceof RegExp);
  assert.equal(conditions[0].title.source, 'fertilizer');
  assert.equal(conditions[0].title.flags, 'i');

  // Somebody searching `1,400` or `(chairman)` means those characters, not a
  // pattern — an unescaped bracket would throw, and a dot would match anything.
  const money = minuteSearchConditions('1,400');
  assert.equal(money[1].content.test('We collected 1,400 that day'), true);
  assert.equal(money[1].content.test('We collected 12400 that day'), false);

  const brackets = minuteSearchConditions('(chairman)');
  assert.equal(brackets[0].title.test('(Chairman) opened'), true);
  assert.equal(brackets[0].title.test('chairman opened'), false);
});

test('a date typed the way the office writes one searches the date too', () => {
  const day = minuteSearchConditions('21/05/2026');
  assert.equal(day.length, 3);
  assert.equal(day[2].date.$gte.toISOString(), '2026-05-21T00:00:00.000Z');
  assert.equal(day[2].date.$lt.toISOString(), '2026-05-22T00:00:00.000Z');

  // ISO, a two-digit year and a year on its own are the same kind of question.
  assert.equal(minuteSearchConditions('2026-05-21')[2].date.$gte.toISOString(), '2026-05-21T00:00:00.000Z');
  assert.equal(minuteSearchConditions('21.5.26')[2].date.$gte.toISOString(), '2026-05-21T00:00:00.000Z');
  assert.equal(minuteSearchConditions('2026')[2].date.$gte.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(minuteSearchConditions('2026')[2].date.$lt.toISOString(), '2027-01-01T00:00:00.000Z');

  // A word that merely contains digits is not a date.
  assert.equal(minuteSearchConditions('Min 12')[2], undefined);
  assert.equal(dateRangeForTerm('123456789'), null);
});

test('a day that does not exist matches nothing rather than rolling over', () => {
  // 31/02 must not quietly become 3 March and hand back a meeting nobody asked for.
  assert.equal(dateRangeForTerm('31/02/2026'), null);
  assert.equal(dateRangeForTerm('2026-02-31'), null);
  assert.equal(dateRangeForTerm('nonsense'), null);

  assert.equal(dateMatchesTerm(new Date('2026-05-21T00:00:00.000Z'), '21/05/2026'), true);
  assert.equal(dateMatchesTerm(new Date('2026-05-21T00:00:00.000Z'), '2026'), true);
  assert.equal(dateMatchesTerm(new Date('2026-05-21T00:00:00.000Z'), '22/05/2026'), false);
  assert.equal(dateMatchesTerm(new Date('2026-05-21T00:00:00.000Z'), 'fertilizer'), false);
});

test('a result shows the words around the hit', () => {
  const body = plainTextOf(
    '<p>The group agreed that the fertilizer subsidy would be revisited in June, '
    + 'once the treasurer had reported on the cost of the second season.</p>'
  );

  const snippet = snippetAround(body, 'fertilizer', 20);
  assert.match(snippet, /fertilizer/);
  assert.match(snippet, /^…/);
  assert.match(snippet, /…$/);
  assert.ok(snippet.length < body.length);

  // At the very start of the text there is nothing to elide, and a radius wide
  // enough to reach the beginning of the sentence shows it whole.
  assert.equal(snippetAround('Fertilizer was approved', 'fertilizer', 30), 'Fertilizer was approved');
  assert.equal(snippetAround(body, 'fertilizer', 30).startsWith('…'), false);

  assert.equal(snippetAround(body, 'tractor'), null);
  assert.equal(snippetAround(body, ''), null);
});

test('a hit on markup is not a result, and a word split by markup still is', () => {
  const markupOnly = minute({
    title: 'Weekly meeting',
    content: '<p><a href="https://example.co.ke/minutes">the file</a></p>',
  });
  // `href`, `https` and `strong` are in the document to a regex and in nobody's
  // mouth; a result with nothing visible to explain it is worse than no result.
  assert.equal(explainMatch(markupOnly, 'href'), null);
  assert.equal(explainMatch(markupOnly, 'https'), null);
  assert.equal(explainMatch(markupOnly, 'p'), null);
  // The words the reader can actually see are found.
  assert.equal(explainMatch(markupOnly, 'the file').field, 'content');

  const bolded = minute({
    title: 'Weekly meeting',
    content: '<p>Min <strong>12</strong>/2026 was read.</p>',
  });
  assert.equal(explainMatch(bolded, '12/2026').field, 'content');
});

test('which part of the minute answered is reported', () => {
  const written = minute({
    title: 'Weekly meeting — 21 May 2026',
    content: '<p>Confirmation of last week\'s minutes.</p><p>The fertilizer subsidy was approved.</p>',
  });

  const inBody = explainMatch(written, 'fertilizer');
  assert.equal(inBody.field, 'content');
  assert.match(inBody.snippet, /fertilizer subsidy was approved/);

  assert.deepEqual(explainMatch(written, 'Weekly'), { field: 'title', snippet: '' });
  assert.deepEqual(explainMatch(written, '21/05/2026'), { field: 'date', snippet: '' });

  // Case is the reader's business, not the search's.
  assert.equal(explainMatch(written, 'FERTILIZER').field, 'content');
  assert.equal(explainMatch(written, 'FERTILIZER').snippet.includes('fertilizer'), true);

  assert.equal(explainMatch(written, 'tractor'), null);
  assert.equal(explainMatch(written, '   '), null);
});
