// The meeting report, part: format. utils/meetingReport.js is the index everything else requires.

const { canDraw } = require('../pdfFonts');

// ------------------------------------------------------------------------------------- the PDF

const numberFmt = new Intl.NumberFormat('en-KE');

function money(amount) {
  return `Ksh ${numberFmt.format(Number(amount) || 0)}`;
}

// In the group's own timezone, not the server's: a week starts at midnight Nairobi time, which is the
// evening before on a host that runs on UTC, and the page would print the Thursday as the Wednesday.
function shortDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Nairobi',
  });
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The page is set in an embedded font (pdfFonts.js) that draws every letter of Gikuyu, Kiswahili and the other Kenyan
// languages, so "Ngũgĩ" prints as written. A character even that font lacks is not skipped or drawn as some other, wrong
// glyph, which on a page of names and money is worse than an honest substitute: the plain letter stands in (ũ -> u), and
// what cannot be drawn at all (another script, an emoji) becomes "?". If the font file were missing from a deploy the page
// falls back to the built-in Helvetica (Latin-1 only), and everything above it is spelled out as before.
const CP1252_EXTRAS = new Set(
  '‘’‚“”„†‡•…‰‹›€™' +
    '–—ŒœŠšŸŽžƒˆ˜'
);

const LETTER_FALLBACKS = { Ŋ: 'N', ŋ: 'n' };

function printable(value) {
  if (typeof value !== 'string') return value;
  let out = '';
  // for..of walks code points, so an emoji is one character to replace, not two broken halves.
  // Composed (ĩ as one letter, not i and a floating tilde): the font draws the one-piece letter.
  for (const char of value.normalize('NFC')) {
    const code = char.codePointAt(0);
    if (code >= 0x100 && canDraw(char)) {
      out += char;
      continue;
    }
    if (((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) || CP1252_EXTRAS.has(char) || code === 10) {
      out += char;
      continue;
    }
    const plain = LETTER_FALLBACKS[char] || char.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += plain.length > 0 && [...plain].every((c) => c.codePointAt(0) <= 0xff) ? plain : '?';
  }
  return out;
}

module.exports = {
  money,
  plural,
  printable,
  shortDate,
};
