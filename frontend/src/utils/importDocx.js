// Reading a Word document the office already has, so a minute written in Word does
// not have to be retyped into the editor.
//
// Two waits used to be paid one after the other: the file dialog only appeared once
// mammoth (and its unzipper) had come down the line, and only then could a file be
// chosen. They are started together now, so the download is spent while somebody is
// choosing, and the parser is warmed when the pointer heads for the button — a pick
// then usually costs nothing at all.
//
// mammoth is reached with `import()` rather than a top-level import: it is a quarter
// of a megabyte, and nobody writing a minute by hand should have to download it.

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Fetched once, and the same promise handed to everybody who asks — two imports in a
// row (a warm-up, then the real one) must not download the parser twice.
let parserPromise = null;

function loadParser() {
  if (!parserPromise) {
    parserPromise = import('mammoth').then((module) => module.default ?? module);
  }
  return parserPromise;
}

// What is wrong with the chosen file's name, or null when nothing is. The mistake
// that actually happens is a `.doc` — the older Word format, which mammoth cannot
// read — so it is refused by name, before anything is parsed.
export function docxProblem(fileName) {
  return /\.docx$/i.test(String(fileName ?? '')) ? null : 'Please upload a .docx file';
}

// Called when somebody's hand is on its way to the Import button. A warm-up that
// fails is not an error yet: the real attempt reports its own failure.
export function preloadDocxParser() {
  return loadParser().catch(() => null);
}

// The chosen file as HTML, or an error saying what was wrong with it.
export async function importDocxFile(file) {
  if (!file) throw new Error('No file provided');

  const problem = docxProblem(file.name);
  if (problem) throw new Error(problem);

  const mammoth = await loadParser();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });

  if (result.messages.length > 0) {
    console.warn('Docx conversion warnings:', result.messages);
  }

  return result.value;
}

// Opens the file dialog and resolves with the imported HTML, or with **null** when
// the office closes the dialog without choosing anything.
//
// That null is the fix for a stuck button: no `change` event fires when a dialog is
// cancelled, so the promise this used to hand back never settled at all and the
// Import button read "Importing…" for the rest of the session.
export async function promptForDocxImport() {
  // Started before the dialog opens: the download overlaps the choosing of the file.
  loadParser().catch(() => null);

  const file = await pickDocxFile();
  if (!file) return null;

  return importDocxFile(file);
}

function pickDocxFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.docx, ${DOCX_MIME}`;
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}
