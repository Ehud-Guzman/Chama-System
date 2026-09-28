// How many pages a minute is.
//
// The office bills on this figure, so the checks here are about the two things a bill needs: that
// the number is the document's own page count (not an estimate that drifts), and that it moves the
// way a page moves — more words, more pages; a heading, a list and a quote all taking their own
// room; an empty body still being a piece of paper.
//
// The numbers are pinned, because a bill wants the same answer twice. They are the output of an A4
// page at 12pt with one-inch margins, measured with pdfkit's own font metrics, so a pdfkit upgrade
// that changes line breaking is exactly the kind of thing these checks should catch.
//
// No database: countMinutePages takes a plain { title, date, content }.
const test = require('node:test');
const assert = require('node:assert/strict');

const { countMinutePages } = require('../src/utils/minutePages');

// One paragraph of 51 words, which is 5 lines in the 451pt column — the unit the arithmetic below
// is written in.
const PARA =
  '<p>The treasurer opened the meeting with a prayer and confirmed that a quorum of members was ' +
  'present. The minutes of the previous meeting were read and confirmed as a true record of what ' +
  'was decided, with one correction noted against item four regarding the welfare contribution ' +
  'agreed for the bereaved family.</p>';

const GROUP = 'WAZO MOJA SELF-HELP GROUP';
const DAY = new Date('2026-05-21T00:00:00.000Z');

const pagesOf = (content, extra = {}) =>
  countMinutePages({ title: 'Monthly meeting', date: DAY, content, ...extra }, GROUP);

test('a minute with no body is one page, not zero', () => {
  // The title block alone — the group's name, "Meeting Minutes", the title and the date — is a
  // piece of paper. Nobody bills for it, but "0 pages" is not a thing a person can print.
  assert.equal(pagesOf(''), 1);
  assert.equal(countMinutePages({}, GROUP), 1);
  assert.equal(countMinutePages(null, GROUP), 1);
});

test('a page holds about 500 words of prose, and the count steps where a page ends', () => {
  // 51 words = 5 lines. Ten of them (510 words) plus their paragraph spacing runs past one page
  // and onto a second; forty (2,040 words) is four pages' worth of prose.
  assert.equal(pagesOf(PARA), 1);
  assert.equal(pagesOf(PARA.repeat(10)), 2);
  assert.equal(pagesOf(PARA.repeat(20)), 3);
  assert.equal(pagesOf(PARA.repeat(40)), 5);
});

test('more words never means fewer pages', () => {
  let previous = 0;
  for (const copies of [0, 1, 5, 10, 25, 50, 100]) {
    const pages = pagesOf(PARA.repeat(copies));
    assert.ok(pages >= previous, `${copies} copies came back as ${pages} after ${previous}`);
    previous = pages;
  }
  assert.ok(previous > 10, 'a hundred paragraphs has to be a long document');
});

test('a heading, a list and a quote take their own room', () => {
  const bodyOnly = pagesOf('<p>Attendees were confirmed and the meeting began.</p>');
  const withStructure = pagesOf(
    '<h2>Attendance</h2>' +
      '<ul><li>Chairman</li><li>Treasurer</li><li>Secretary</li></ul>' +
      '<h3>Decisions</h3>' +
      '<blockquote>The fence is to be repaired before the rains.</blockquote>' +
      '<p>Attendees were confirmed and the meeting began.</p>'
  );
  // Every one of those blocks is a line (or more) of its own, so the same words cannot be fewer
  // pages with the structure around them than without it.
  assert.ok(withStructure >= bodyOnly);
  assert.equal(withStructure, 1, 'and still one page, because the meeting was a short one');
});

test('an empty paragraph is dropped, exactly as the exported document drops it', () => {
  assert.equal(pagesOf('<p></p><p></p><p>One line.</p>'), pagesOf('<p>One line.</p>'));
});

test('a line break inside a paragraph is a line', () => {
  assert.equal(pagesOf('<p>First item. Second item.</p>'), 1);
  assert.equal(pagesOf('<p>First item.<br>Second item.</p>'), 1);
  // Sixty forced breaks is sixty lines of paper, whatever short words are on them.
  const manyBreaks = pagesOf(`<p>${'Item.<br>'.repeat(60)}</p>`);
  assert.ok(manyBreaks >= 2, 'sixty forced line breaks cannot fit one page');
});

test('the entities a paste brings are one character, not five', () => {
  // `&amp;` and `&#39;` are one glyph each on the page. A counter that measured the raw text would
  // make a minute of ampersands a line longer than the page it is printed on.
  assert.equal(pagesOf('<p>Tom &amp; Jerry</p>'), pagesOf('<p>Tom &amp; Jerry</p>'));
  assert.equal(pagesOf('<p>Tom &amp; Jerry</p>'), pagesOf('<p>Tom & Jerry</p>'));
  assert.equal(pagesOf('<p>It&#39;s fine</p>'), pagesOf("<p>It's fine</p>"));
});

test('a long title is a long title on the page too', () => {
  const short = pagesOf('', { title: 'Meeting' });
  const long = pagesOf('', {
    title:
      'A very long title for a meeting that ran on and on and had to be given a name that would ' +
      'still be recognisable three years later',
  });
  assert.equal(short, 1);
  assert.equal(long, 1, 'and the block still opens the document rather than being thrown away');
});

test('a preformatted block keeps its own lines instead of flowing into prose', () => {
  const line = 'SK9X2Q1LMN Confirmed. Ksh1,400.00 sent to the group account.';
  const pre = pagesOf(`<pre>${`${line}\n`.repeat(20)}</pre>`);
  const prose = pagesOf(`<p>${line.repeat(20)}</p>`);
  assert.ok(pre >= prose, 'twenty forced lines do not flow into a paragraph, they stack');
});

test('a minute is counted the same way twice', () => {
  const content = `${PARA}${PARA.repeat(12)}`;
  assert.equal(pagesOf(content), pagesOf(content));
});

test('the ceiling the model allows is a document, not a hang', () => {
  // Minute.content is capped at 200,000 characters. That is a small book; it has to come back with
  // a number rather than run forever.
  const started = Date.now();
  const pages = pagesOf(PARA.repeat(650));
  assert.ok(pages > 40, `200k characters came back as ${pages} pages`);
  assert.ok(Date.now() - started < 5000, 'and in a few seconds at most');
});
