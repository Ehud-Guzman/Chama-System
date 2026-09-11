// Downloads a minute as a real .doc file Word can open directly, using
// Word's own HTML import format (mso namespaces) — no server round trip
// and no extra dependency, since Word already knows how to read this.
export function exportMinuteAsWord({ title, date, content }) {
  const safeTitle = (title || 'Untitled minute').trim();
  const dateLabel = date
    ? new Date(date).toLocaleDateString('en-KE', { day: '2-digit', month: 'long', year: 'numeric' })
    : '';

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(safeTitle)}</title>
<!--[if gte mso 9]>
<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml>
<![endif]-->
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 12pt; }
  h1 { font-size: 18pt; margin-bottom: 4pt; }
  .meta { color: #555; font-size: 10pt; margin-bottom: 16pt; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 12pt; color: #555; }
</style>
</head>
<body>
<h1>${escapeHtml(safeTitle)}</h1>
${dateLabel ? `<p class="meta">${escapeHtml(dateLabel)}</p>` : ''}
${content || ''}
</body>
</html>`;

  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slugify(safeTitle)}.doc`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function slugify(str) {
  return str.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'minute';
}
