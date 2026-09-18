const sanitizeHtml = require('sanitize-html');

// Meeting minutes are written in a rich-text editor and rendered as HTML on a
// member's phone. The editor's own schema is what makes that safe today — Tiptap
// cannot represent a <script>, so it can never appear in what the editor saves —
// but that is a property of *one client*, and the API is the thing everybody else
// talks to (a script, a future app, a paste from somewhere else).
//
// So the rule is enforced where the document is stored: the allowlist below is
// exactly what the editor can produce, so a legitimate minute round-trips
// unchanged, and anything else is dropped rather than stored.
const OPTIONS = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'del',
    'h1',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'hr',
    'a',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // No styles, no classes, no ids: nothing in the editor needs them and each one
  // is a way to smuggle behaviour into a page.
  allowedStyles: {},
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
  },
};

// Returns the safe HTML. Empty in, empty out — a blank body stays blank rather
// than becoming '<p></p>' or an error.
function sanitizeMinuteHtml(html) {
  const text = String(html ?? '');
  if (!text.trim()) return '';
  return sanitizeHtml(text, OPTIONS);
}

module.exports = { sanitizeMinuteHtml, MINUTE_HTML_OPTIONS: OPTIONS };
