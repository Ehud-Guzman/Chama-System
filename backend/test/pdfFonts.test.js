// The embedded PDF font (utils/pdfFonts): names print as they are written, nothing moves, and a missing or switched-off
// font puts the documents back in the standard fonts instead of breaking them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PassThrough } = require('node:stream');
const PDFDocument = require('pdfkit');

const { EMBEDDED, canDraw } = require('../src/utils/pdfFonts');
const { renderExpenseReportPdf, buildExpenseReport } = require('../src/utils/expenseReport');
const { printable } = require('../src/utils/meetingReport');

const FONT_DIR = path.join(__dirname, '..', 'src', 'assets', 'fonts');

async function pdfOf(draw) {
  const sink = new PassThrough();
  sink.setHeader = () => {};
  const chunks = [];
  sink.on('data', (c) => chunks.push(c));
  draw(sink);
  await new Promise((resolve) => sink.on('end', resolve));
  return Buffer.concat(chunks).toString('latin1');
}

test('the four font files are shipped with their licence', () => {
  for (const file of ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-BoldItalic.ttf', 'LICENSE-LiberationSans.txt']) {
    assert.ok(fs.existsSync(path.join(FONT_DIR, file)), `${file} is missing from src/assets/fonts`);
  }
  assert.match(fs.readFileSync(path.join(FONT_DIR, 'LICENSE-LiberationSans.txt'), 'utf8'), /SIL OPEN FONT LICENSE/);
});

test('the font draws every letter a Kenyan name needs', () => {
  assert.equal(EMBEDDED, true);
  for (const ch of 'ĩũĨŨŋɛɔñéü—–‘’“”…') assert.equal(canDraw(ch), true, `${ch} (U+${ch.codePointAt(0).toString(16)})`);
  assert.equal(canDraw('😀'), false);
});

test('a name prints as written; only what even the embedded font lacks is spelled out', () => {
  assert.equal(printable('Ngũgĩ wa Thiong’o'), 'Ngũgĩ wa Thiong’o');
  assert.equal(printable('Ŋgũgĩ'), 'Ŋgũgĩ');
  assert.equal(printable('Wĩlson ã'), 'Wĩlson ã', 'a letter typed as base plus tilde is composed first');
  assert.equal(printable('日本'), '??');
  assert.equal(printable('Hi 😀!'), 'Hi ?!');
});

test('the names the renderers ask for now mean the embedded font, in all four faces', () => {
  const doc = new PDFDocument();
  const names = {};
  for (const face of ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']) {
    doc.font(face);
    names[face] = doc._font.font.postscriptName;
  }
  assert.deepEqual(names, {
    Helvetica: 'LiberationSans',
    'Helvetica-Bold': 'LiberationSans-Bold',
    'Helvetica-Oblique': 'LiberationSans-Italic',
    'Helvetica-BoldOblique': 'LiberationSans-BoldItalic',
  });
});

test('letter widths match Helvetica, so no page layout moves', () => {
  const embedded = new PDFDocument();
  embedded.font('Helvetica').fontSize(10);
  const sample = 'Member register: Amina Wekesa, Ksh 12,500 owed (3 weeks behind)';
  // Helvetica's own letter widths, from the metrics file PDFKit ships for the standard font.
  const afm = fs.readFileSync(require.resolve('pdfkit/js/data/Helvetica.afm'), 'latin1');
  const width = {};
  for (const m of afm.matchAll(/^C\s+(-?\d+)\s*;\s*WX\s+(\d+)\s*;\s*N\s+(\S+)/gm)) if (Number(m[1]) >= 0) width[Number(m[1])] = Number(m[2]);
  const expected = [...sample].reduce((sum, ch) => sum + (width[ch.charCodeAt(0)] || 0), 0) * 10 / 1000;
  assert.ok(Math.abs(embedded.widthOfString(sample) - expected) < expected * 0.01, `${embedded.widthOfString(sample)} vs ${expected}`);
});

test('a spending report is a finished PDF set in the embedded font', async () => {
  const report = buildExpenseReport({ expenses: [], position: { funds: [] } });
  const pdf = await pdfOf((sink) => renderExpenseReportPdf(sink, report, 'Example Chama'));
  assert.match(pdf, /^%PDF-/);
  assert.match(pdf, /%%EOF/);
  assert.match(pdf, /LiberationSans/, 'the embedded font is in the file');
  assert.doesNotMatch(pdf, /\/BaseFont \/Helvetica/, 'and no standard Helvetica is');
  assert.match(pdf, /ToUnicode/, 'text can still be copied out of the file');
});

test('PDF_FONTS=standard puts the documents back in the standard fonts and spells the letters out', () => {
  const out = execFileSync(
    process.execPath,
    ['-e', "const {printable}=require('./src/utils/meetingReport');const {EMBEDDED}=require('./src/utils/pdfFonts');const D=require('pdfkit');const d=new D();d.font('Helvetica');console.log(JSON.stringify({e:EMBEDDED,p:printable('Wĩlson Kĩnũthia'),f:d._font.name}))"],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, PDF_FONTS: 'standard' }, encoding: 'utf8' }
  );
  assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), { e: false, p: 'Wilson Kinuthia', f: 'Helvetica' });
});
