// The one function both the editor and the read-only reader need. It lives on its
// own so the reader — which is what the members' page renders — can import it
// without pulling in the editor component and its toolbar.
//
// Plain text saved before the editor existed doesn't carry line breaks in HTML,
// so turn bare newlines into paragraphs the first time it's opened.
export function toEditorHtml(content) {
  if (!content) return '';
  if (/<[a-z][\s\S]*>/i.test(content)) return content;
  return content
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}
