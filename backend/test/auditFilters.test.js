// The audit filters, as a query.
//
// The one that matters is the day boundary. An officer narrowing to "up to 24 Sept"
// is asking for the collection night's entries too, and an entry logged at 9pm EAT
// belongs to that evening — a bound at UTC midnight would hide exactly the rows
// somebody opens the trail to find. The rest is guarding against a filter that
// quietly matches nothing, or a search string that acts as a pattern.
//
// Pure: no database.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFilters, ENTITIES_BY_CATEGORY, ACTIONS } = require('../src/utils/auditFilters');
const { parseEatDate, DAY_MS } = require('../src/utils/weekCycle');

const DAY = (date) => parseEatDate(date).getTime();

test('no filters means no conditions', () => {
  assert.deepEqual(buildFilters({}), { match: {}, unusual: false });
  assert.deepEqual(buildFilters().match, {});
});

test('a category becomes the entities it covers', () => {
  const { match } = buildFilters({ category: 'money' });
  assert.deepEqual(match.entityType.$in.sort(), [...ENTITIES_BY_CATEGORY.money].sort());
  assert.ok(match.entityType.$in.includes('Contribution'));
  assert.ok(match.entityType.$in.includes('Fine'));
  assert.ok(!match.entityType.$in.includes('Member'));
});

test('a named record beats the category it sits in', () => {
  const { match } = buildFilters({ category: 'money', entity: 'Expense' });
  assert.equal(match.entityType, 'Expense');
});

test('an unknown category or action is ignored rather than matching nothing', () => {
  // A stale bookmark should show the trail, not an empty screen.
  assert.deepEqual(buildFilters({ category: 'nonsense' }).match, {});
  assert.deepEqual(buildFilters({ action: 'nonsense' }).match, {});
  assert.deepEqual(ACTIONS, ['create', 'update', 'delete', 'reset']);
});

test('a date range is the group\'s own days, and the last day is included whole', () => {
  const { match } = buildFilters({ from: '2026-09-18', to: '2026-09-24' });
  assert.equal(match.createdAt.$gte.getTime(), DAY('2026-09-18'));
  // Exclusive bound on the next midnight: 9pm on the 24th is inside the range.
  assert.equal(match.createdAt.$lt.getTime(), DAY('2026-09-24') + DAY_MS);
  const eveningOfThe24th = DAY('2026-09-24') + 21 * 3600 * 1000;
  assert.ok(eveningOfThe24th >= match.createdAt.$gte.getTime());
  assert.ok(eveningOfThe24th < match.createdAt.$lt.getTime());
});

test('one end of a range on its own works', () => {
  const onwards = buildFilters({ from: '2026-09-18' }).match;
  assert.equal(onwards.createdAt.$gte.getTime(), DAY('2026-09-18'));
  assert.equal(onwards.createdAt.$lt, undefined);

  const upTo = buildFilters({ to: '2026-09-24' }).match;
  assert.equal(upTo.createdAt.$lt.getTime(), DAY('2026-09-24') + DAY_MS);
  assert.equal(upTo.createdAt.$gte, undefined);
});

test('the person filter only accepts a real id', () => {
  const id = '6a85c8a0bf3d0f319aa0172e';
  assert.equal(buildFilters({ by: id }).match.performedBy, id);
  // Anything that is not an id would throw inside Mongo, so it is dropped.
  assert.equal(buildFilters({ by: 'Anne' }).match.performedBy, undefined);
});

test('a search is a search, not a pattern', () => {
  const { match } = buildFilters({ q: 'Example (Member)' });
  const regexes = match.$or.map((clause) => Object.values(clause)[0]);
  // Escaped in the source, so the brackets are characters rather than a group.
  assert.ok(regexes.every((rx) => rx.source.includes('\\(') && rx.source.includes('\\)')));
  assert.ok(regexes[0].test('Example (Member)'));

  // And a pattern typed into the box stays text: this one matches nothing, rather
  // than matching everybody.
  const pattern = buildFilters({ q: '^(.*)$' }).match.$or[0]['after.name'];
  assert.ok(!pattern.test('Example Member'));
  assert.ok(pattern.test('^(.*)$'));

  assert.equal(buildFilters({ q: '   ' }).match.$or, undefined);
});
