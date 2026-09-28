import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Table, TableCell, TableRow, WidthType } from 'docx';

const dateFormat = (d) =>
  new Date(d).toLocaleDateString('en-KE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

// Convert HTML to text (strip tags but preserve structure)
function htmlToPlainText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (
    Array.from(div.childNodes)
      .map((node) => {
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeName === 'BR') return '\n';
        if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(node.nodeName)) return node.textContent + '\n';
        if (node.nodeName === 'P') return node.textContent + '\n';
        if (node.nodeName === 'LI') return '• ' + node.textContent + '\n';
        if (['UL', 'OL'].includes(node.nodeName)) {
          return Array.from(node.children)
            .map((li) => '• ' + li.textContent)
            .join('\n');
        }
        return node.textContent;
      })
      .join('')
      .trim() || ''
  );
}

// Parse HTML-based sections into structured content for .docx
function parseMinuteContent(html) {
  if (!html) return [];
  const div = document.createElement('div');
  div.innerHTML = html;

  const sections = [];
  let currentSection = null;

  Array.from(div.children).forEach((el) => {
    if (['H1', 'H2', 'H3'].includes(el.nodeName)) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        title: el.textContent,
        items: [],
      };
    } else if (el.nodeName === 'P' && el.textContent.trim()) {
      if (!currentSection) currentSection = { title: '', items: [] };
      currentSection.items.push(el.textContent);
    } else if (el.nodeName === 'UL' || el.nodeName === 'OL') {
      if (!currentSection) currentSection = { title: '', items: [] };
      Array.from(el.children).forEach((li) => {
        currentSection.items.push(li.textContent);
      });
    }
  });

  if (currentSection) sections.push(currentSection);
  return sections;
}

// The page a minute is printed on, and the one its page count is measured against
// (backend/src/utils/minutePages counts A4 at 12pt with one-inch margins).
//
// This used to be whatever the document library defaults to — Letter, 11pt, Calibri — which meant
// the screen's page count and the sheets coming out of the printer were two different documents.
// A4 with one-inch margins is the group's own rule; Arial is chosen for the body because it is
// metrically compatible with the Helvetica the counter measures, so Word breaks the lines in the
// same places and the two agree.
//
// Twips: 1/20th of a point, which is what the library wants. Sizes are half-points, so 24 is 12pt.
const A4 = { width: 11906, height: 16838 };
const INCH = 1440;
const PAGE_SETTINGS = {
  size: A4,
  margin: { top: INCH, right: INCH, bottom: INCH, left: INCH },
};
const PAGE_STYLES = {
  default: {
    document: { run: { font: 'Arial', size: 24 } },
    // The heading sizes the page counter measures with, so a heading takes the same room in both
    // documents: 16pt, 14pt and 13pt.
    heading1: { run: { font: 'Arial', size: 32, bold: true } },
    heading2: { run: { font: 'Arial', size: 28, bold: true } },
    heading3: { run: { font: 'Arial', size: 26, bold: true } },
  },
};

export async function exportMinuteAsDocx({ title, date, content, chamaName = 'Chama Minutes' }) {
  const sections = parseMinuteContent(content);
  const plainText = htmlToPlainText(content);

  const docElements = [
    new Paragraph({
      text: chamaName,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 0 },
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      text: 'Meeting Minutes',
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      text: title || 'Untitled Meeting',
      heading: HeadingLevel.HEADING_3,
      spacing: { after: 100 },
    }),
    new Paragraph({
      text: dateFormat(date || new Date()),
      style: 'Normal',
      spacing: { after: 400 },
      italics: true,
    }),
  ];

  // If structured sections detected, use them; otherwise just dump the plain text
  if (sections.length > 0 && sections.some((s) => s.title)) {
    sections.forEach((section) => {
      if (section.title) {
        docElements.push(
          new Paragraph({
            text: section.title,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          })
        );
      }
      section.items.forEach((item) => {
        docElements.push(
          new Paragraph({
            text: item,
            spacing: { after: 100 },
          })
        );
      });
    });
  } else {
    // Fallback: just paste the plain text content
    plainText.split('\n\n').forEach((para) => {
      if (para.trim()) {
        docElements.push(
          new Paragraph({
            text: para.trim(),
            spacing: { after: 100 },
          })
        );
      }
    });
  }

  const doc = new Document({
    styles: PAGE_STYLES,
    sections: [{ properties: { page: PAGE_SETTINGS }, children: docElements }],
  });
  const blob = await Packer.toBlob(doc);

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slugify(title || 'minute')}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function slugify(str) {
  return String(str).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'minute';
}
