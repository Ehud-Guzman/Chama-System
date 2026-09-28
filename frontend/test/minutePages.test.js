// The words the page count is shown in.
//
// One figure is read on three screens — the office's list, the office's open minute and the members'
// own page — and this is what stops them drifting into "3 pages", "3 page" and "3.0 pages". The
// number itself is the server's (a real layout of the document); all that is decided here is how to
// put it in a sentence.
//
// The extension is explicit because Node's resolver needs one and Vite does not.
import test from 'node:test';
import assert from 'node:assert/strict';

import { pageCountLabel, pageCountTitle, PAGE_COUNT_RULE } from '../src/utils/minutePages.js';

test('one page is not "1 pages"', () => {
  assert.equal(pageCountLabel(1), '1 page');
  assert.equal(pageCountLabel(2), '2 pages');
  assert.equal(pageCountLabel(74), '74 pages');
});

test('a minute nobody has counted says nothing, rather than saying zero', () => {
  // A minute saved before the count existed has `pages: null` until
  // scripts/countMinutePages.js runs. "0 pages" would be a wrong answer said confidently, and a
  // blank is the honest one.
  assert.equal(pageCountLabel(null), null);
  assert.equal(pageCountLabel(undefined), null);
  assert.equal(pageCountLabel(0), null);
  assert.equal(pageCountLabel(-3), null);
  assert.equal(pageCountLabel(''), null);
});

test('a count that arrives as text is still a count', () => {
  // JSON does not care, and a figure that reads "2 pages" one request and "2 pages" the next is
  // the point of the whole module.
  assert.equal(pageCountLabel('2'), '2 pages');
  assert.equal(pageCountLabel('1'), '1 page');
});

test('nonsense is treated as no answer at all', () => {
  assert.equal(pageCountLabel('three'), null);
  assert.equal(pageCountLabel(NaN), null);
  assert.equal(pageCountLabel(Infinity), null);
  assert.equal(pageCountLabel({}), null);
});

test('the rule a bill is argued over travels with the figure', () => {
  assert.equal(pageCountTitle(4), `4 pages — ${PAGE_COUNT_RULE}`);
  // And nothing to hover when there is no figure.
  assert.equal(pageCountTitle(null), null);
  assert.ok(PAGE_COUNT_RULE.includes('A4'), 'the page size is the whole point of the rule');
});
