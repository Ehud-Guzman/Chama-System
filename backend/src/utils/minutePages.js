const PDFDocument = require('pdfkit');
const { entityText } = require('./minuteSearch');

// How many pages a minute is.
//
// The group bills by the page, so the number has to be a page count somebody can check rather
// than a guess dressed up as one. This counts the pages of the document the minute *is* when it
// is set on A4 at 12pt with one-inch margins — the group's own rule — by laying it out with the
// same engine the statements and reports are already rendered with (pdfkit, a backend dependency
// since the first member statement). pdfkit knows the real metrics of every glyph, so a line that
// wraps is a line that wrapped: what comes back is not "about 500 words a page" but the count of
// the document the words make.
//
// Why it is measured rather than counted from an estimate: a bill that says four pages when the
// paper says three is an argument, and it is the treasurer who has to have it. Two things make
// this number verifiable instead:
//
//   * **The same renderer that would print it counts it.** `drawMinute` is the whole document;
//     `countMinutePages` is the page range pdfkit reports after laying it out, which is what the
//     footer of a real print would say. A PDF download later cannot disagree with this figure,
//     because it would be the same code laying out the same blocks.
//   * **The Word copy the office downloads is set to the same page** (frontend/utils/exportDocx:
//     A4, 12pt, one-inch margins, Arial). Arial is metrically compatible with Helvetica, which is
//     the font measured here, so Word breaks the lines in the same places and paginates the same
//     way — to within a line, which is worth saying to anybody who asks why it reads 4 and not 3.
//
// It is deliberately not stored as a promise: `Minute.pages` holds the count, a minute recounts
// itself whenever it is saved, and scripts/countMinutePages.js recounts the whole library (which
// is what to run if these rules ever change).
const PAGE = { width: 595.28, height: 841.89 }; // A4, in points
const MARGIN = 72; // one inch = 2.54 cm — Word's own default margin, and a sane one to bill on
const BODY_SIZE = 12; // 12pt: the group's rule, not Word's 11pt default
const BODY_FONT = 'Helvetica'; // metric-compatible with the Arial the export writes
// Word's single spacing at 12pt is ~13.8pt of line. Helvetica's own line height is 0.925 × the
// size (11.1pt at 12pt), so the difference is added back as a line gap rather than left out —
// without it every minute would read a fifth shorter than the paper it is printed on.
const LINE_GAP = 2.7;

// Room around each kind of block, in points, matching what the Word export asks for: paragraphs
// 100 twips (5pt) apart, a section heading with 200 twips (10pt) above it, the date line 400
// twips (20pt) below it. The two documents are meant to be the same page, so they are spaced the
// same way rather than by eye.
const SPACE = { paragraph: 5, heading: 10, listItem: 2, title: 5, date: 20, rule: 10 };

// The heading sizes of the export's own Heading 1/2/3 styles. A heading is a line or two either
// way, but a size nobody can point at is a size that drifts.
const HEADING_SIZE = { h1: 16, h2: 14, h3: 13 };

// A bulleted or numbered line is indented, and its continuation lines line up under the text
// rather than under the bullet — the same hanging indent the rendered minute has.
const LIST_INDENT = 18;

// The named entities the editor's own output can contain, plus the numeric escapes a paste can
// arrive with. Resolved by the search module's own decoder, so a word cannot be one thing to a
// search and another thing to the page count.

// The marks the editor can put inside a line. They do not change where a line ends in any way a
// bill should be argued over, so a block's words are measured in the font the *block* is set in —
// body text, a heading, a quote — and the markup inside it decides nothing.
//
// That is also what this pdfkit build allows: its text API lays out one string at a time (an
// array of styled runs is stringified, which is how a paragraph comes out as a single word). The
// alternative — measuring every emphasised word in its own face — would buy a line's worth of
// precision at best, and would put a second HTML parser in the project whose only job was to
// disagree with the editor's.
const LINE_BREAK = /<br\s*\/?>/gi;
const BLOCK_END = /<\/(p|div|li|h[1-6]|blockquote|pre)>/gi;

const BOLD_FONT = 'Helvetica-Bold';
const ITALIC_FONT = 'Helvetica-Oblique';
const MONO_FONT = 'Courier';

// A block's text: what the reader's eye is given, with a real newline where the editor put a line
// break, and the entities resolved the way a search resolves them.
function inlineText(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(LINE_BREAK, '\n')
      .replace(BLOCK_END, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The blocks of the minute, in the order they are read — what the page count is added up from.
// The stored HTML is already sanitised to the editor's own tag set (utils/sanitizeHtml), so this
// walks exactly the tags that can be there: a heading, a paragraph, a list item, a quote, a
// preformatted block, or a rule.
//
// Nested markup is left to the outer block: a paragraph inside a quote *is* the quote, and a list
// item inside a list is that item — which is also how the exported document is built from the same
// content. An empty paragraph is a line the export drops, so it is dropped here too.
const BLOCK_TAGS = /<(h1|h2|h3|p|li|blockquote|pre|div)\b[^>]*>([\s\S]*?)<\/\1>|<hr\b[^>]*>/gi;

function isOrderedList(html, before) {
  const opens = html.slice(0, before);
  return opens.lastIndexOf('<ol') > opens.lastIndexOf('<ul');
}

function blocksOf(html) {
  const source = String(html ?? '');
  const blocks = [];
  let item = 0;
  let match = BLOCK_TAGS.exec(source);

  while (match) {
    // <hr> is the one tag in the set with nothing inside it, so it arrives with no capture.
    if (/^<hr/i.test(match[0])) {
      blocks.push({ kind: 'rule' });
      item = 0;
      match = BLOCK_TAGS.exec(source);
      continue;
    }

    const tag = (match[1] || '').toLowerCase();
    const text = inlineText(match[2]);
    if (!text) {
      item = 0;
    } else if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      blocks.push({ kind: tag, text });
      item = 0;
    } else if (tag === 'li') {
      item += 1;
      blocks.push({ kind: 'li', text, marker: isOrderedList(source, match.index) ? `${item}.` : '•' });
    } else if (tag === 'blockquote') {
      blocks.push({ kind: 'quote', text });
      item = 0;
    } else if (tag === 'pre') {
      blocks.push({ kind: 'pre', text });
      item = 0;
    } else {
      blocks.push({ kind: 'p', text });
      item = 0;
    }

    match = BLOCK_TAGS.exec(source);
  }

  return blocks;
}

function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => entityText(code));
}


// The date the way the exported minute prints it — spelled out, because that is the line the
// reader is handed and it is the one line whose length is fixed rather than typed.
function dateLine(date) {
  const at = new Date(date || Date.now());
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('en-KE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function resetToMargin(doc) {
  doc.x = doc.page.margins.left;
}

// One block of the minute, as the document draws it. Every call is a pdfkit flow call, so the
// pages this breaks are pdfkit's own — the same breaks a printed copy would have.
//
// The `width` is always given explicitly. pdfkit wraps text to the page's own width when it is
// left out, and *does not wrap at all* in some of the paths around indentation — which is how a
// paragraph comes to be measured as one long line and a five-page minute reads as one.
function drawBlock(doc, block) {
  const textWidth = PAGE.width - MARGIN * 2;
  const line = () => doc.currentLineHeight();

  if (block.kind === 'rule') {
    doc.moveDown(SPACE.rule / line());
    doc
      .save()
      .moveTo(MARGIN, doc.y)
      .lineTo(PAGE.width - MARGIN, doc.y)
      .lineWidth(0.5)
      .strokeColor('#999999')
      .stroke()
      .restore();
    doc.moveDown(SPACE.rule / line());
    resetToMargin(doc);
    return;
  }

  if (block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3') {
    doc.moveDown(SPACE.heading / line());
    resetToMargin(doc);
    doc.font(BOLD_FONT).fontSize(HEADING_SIZE[block.kind]);
    doc.text(block.text, { width: textWidth, lineGap: LINE_GAP });
    doc.moveDown(SPACE.paragraph / line());
    return;
  }

  if (block.kind === 'li') {
    // A hanging indent: the bullet sits left of the text and the wrapped lines line up under the
    // first word, exactly as the editor and the exported document show it.
    doc.moveDown(SPACE.listItem / line());
    doc.x = MARGIN + LIST_INDENT;
    doc.font(BODY_FONT).fontSize(BODY_SIZE);
    return void doc.text(`${block.marker} ${block.text}`, {
      width: textWidth - LIST_INDENT,
      indent: -LIST_INDENT,
      lineGap: LINE_GAP,
    });
  }

  if (block.kind === 'quote') {
    doc.moveDown(SPACE.paragraph / line());
    doc.x = MARGIN + LIST_INDENT;
    doc.font(ITALIC_FONT).fontSize(BODY_SIZE);
    return void doc.text(block.text, { width: textWidth - LIST_INDENT, lineGap: LINE_GAP });
  }

  if (block.kind === 'pre') {
    // Preformatted text keeps its own line breaks, and is set in the monospace face a size down
    // so a code sample still fits the column — the way such a block is actually read.
    doc.moveDown(SPACE.paragraph / line());
    resetToMargin(doc);
    doc.font(MONO_FONT).fontSize(BODY_SIZE - 1);
    return void doc.text(block.text, { width: textWidth, lineGap: LINE_GAP });
  }

  doc.moveDown(SPACE.paragraph / line());
  resetToMargin(doc);
  doc.font(BODY_FONT).fontSize(BODY_SIZE);
  doc.text(block.text, { width: textWidth, lineGap: LINE_GAP });
}

// The whole document: who it is from, what it is, which meeting, when — then the minute itself.
// This is the one place the minute's layout is written down, so the count and any copy of the
// document can only ever be the same page.
function drawMinute(doc, minute, chamaName = 'Chama Minutes') {
  // A minute with nothing on it still opens a document (an empty body is a plain thing to be
  // handed), so `null` is read as an empty minute rather than refused.
  const source = minute || {};
  const title = String(source.title || '').trim() || 'Untitled Meeting';
  const textWidth = PAGE.width - MARGIN * 2;
  const line = () => doc.currentLineHeight();

  doc.font(BOLD_FONT).fontSize(HEADING_SIZE.h1);
  doc.text(chamaName, { width: textWidth, align: 'center' });
  doc.moveDown(SPACE.paragraph / line());

  doc.font(BOLD_FONT).fontSize(HEADING_SIZE.h2);
  doc.text('Meeting Minutes', { width: textWidth, align: 'center', lineGap: LINE_GAP });
  doc.moveDown(SPACE.heading / line());

  doc.font(BOLD_FONT).fontSize(HEADING_SIZE.h3);
  doc.text(title, { width: textWidth, lineGap: LINE_GAP });
  doc.moveDown(SPACE.title / line());

  doc.font(ITALIC_FONT).fontSize(BODY_SIZE);
  doc.text(dateLine(source.date), { width: textWidth, lineGap: LINE_GAP });
  doc.moveDown(SPACE.date / line());

  for (const block of blocksOf(source.content)) drawBlock(doc, block);
}

// A4 at 12pt with one-inch margins, as above.
function newDocument() {
  return new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    // The page range is only reported while the pages are kept, and a minute nobody prints costs
    // nothing to lay out: nothing is written, because this document is never ended.
    bufferPages: true,
    compress: false,
  });
}

// How many pages the minute is, as a person counting the sheets would find them. One page is the
// floor: a minute with a title and a date is a piece of paper, whatever its body says.
function countMinutePages(minute, chamaName) {
  const doc = newDocument();
  drawMinute(doc, minute, chamaName);
  return Math.max(1, doc.bufferedPageRange().count);
}

module.exports = {
  countMinutePages,
  // The layout, exported so anything that ever writes the minute out — a PDF beside the Word
  // download, a print view — draws the same document this number was counted from.
  drawMinute,
  newDocument,
  PAGE,
  MARGIN,
  BODY_SIZE,
};
