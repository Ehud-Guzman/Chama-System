const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const fontkit = require('fontkit');

// The fonts every PDF the system writes is set in.
//
// The standard PDF fonts (Helvetica) hold Latin-1 and little else, so a name like "Wĩlson" or "Kĩnũthia" could not be
// printed as written: the letters the font lacks were printed as their plain base letter (ĩ as i). A person's name is
// the one thing on a page that cannot be reworded, so the system now embeds Liberation Sans, a free font (SIL Open Font
// Licence, see assets/fonts/LICENSE-LiberationSans.txt) that has every letter of Gikuyu, Kiswahili and the other Kenyan
// languages written in Latin letters.
//
// Liberation Sans has the same letter widths as Helvetica and Arial, by design, so nothing on any page moves: the
// renderers keep asking for 'Helvetica', 'Helvetica-Bold' and 'Helvetica-Oblique', and those names now mean the embedded
// font. PDFKit remembers a font by its name the first time it is asked for, and sets 'Helvetica' while it builds the
// document, so the names have to be registered BEFORE that, which is why this replaces initFonts instead of calling
// registerFont afterwards.
//
// If a font file were ever missing from a deploy, nothing here changes: the documents are set in the standard fonts
// exactly as before, and printable() (meetingReport.js) goes back to spelling out the letters those fonts lack.
const DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FILES = {
  Helvetica: 'LiberationSans-Regular.ttf',
  'Helvetica-Bold': 'LiberationSans-Bold.ttf',
  'Helvetica-Oblique': 'LiberationSans-Italic.ttf',
  'Helvetica-BoldOblique': 'LiberationSans-BoldItalic.ttf',
};
// PDF_FONTS=standard turns the embedded font off. It is for the tests that read a page's text back (a standard font's text
// is stored as plain character codes; an embedded font's as glyph numbers), and for an emergency: if a deploy ever made
// the documents unreadable, setting it on the host puts every document back in the standard fonts at once.
const WANTED = process.env.PDF_FONTS !== 'standard';
const AVAILABLE = WANTED && Object.values(FILES).every((file) => fs.existsSync(path.join(DIR, file)));

// Which characters the regular face can draw. Read once; the four faces share one character set.
let regular = null;
if (AVAILABLE) {
  try {
    regular = fontkit.openSync(path.join(DIR, FILES.Helvetica));
  } catch {
    regular = null;
  }
}
const EMBEDDED = AVAILABLE && regular !== null;

function canDraw(character) {
  const code = character.codePointAt(0);
  if (!EMBEDDED) return code <= 0xff;
  return regular.hasGlyphForCodePoint(code);
}

if (EMBEDDED) {
  const original = PDFDocument.prototype.initFonts;
  PDFDocument.prototype.initFonts = function initFonts(defaultFont = 'Helvetica', defaultFontFamily = null, defaultFontSize = 12) {
    // Set everything up without choosing a font, register the four names, then choose.
    original.call(this, null, defaultFontFamily, defaultFontSize);
    for (const [name, file] of Object.entries(FILES)) this.registerFont(name, path.join(DIR, file));
    if (defaultFont) this.font(defaultFont, defaultFontFamily);
  };
}

module.exports = { EMBEDDED, canDraw };
