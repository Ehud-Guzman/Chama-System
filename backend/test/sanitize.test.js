// Minutes are written in a rich-text editor and rendered as HTML on a member's
// phone. The editor's own schema is what makes that safe today, but the API is what
// every other client talks to — so the allowlist is enforced where the document is
// stored.
const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeMinuteHtml } = require('../src/utils/sanitizeHtml');

test('a minute written in the editor round-trips unchanged', () => {
  const html =
    '<h2>Min 12/2026</h2><p>The chairman opened the meeting at <strong>7:05pm</strong>.</p>'
    + '<ul><li>Confirmation of last week\'s minutes</li><li>Arrears</li></ul>'
    + '<blockquote>Section 7.4 was read out.</blockquote><p><em>Adjourned</em> at 8:40pm.</p>';
  assert.equal(sanitizeMinuteHtml(html), html);
});

test('scripts, handlers and frames never reach storage', () => {
  assert.equal(sanitizeMinuteHtml('<p>hello<script>alert(1)</script></p>'), '<p>hello</p>');
  assert.equal(sanitizeMinuteHtml('<p onclick="steal()">hi</p>'), '<p>hi</p>');
  assert.equal(sanitizeMinuteHtml('<iframe src="https://evil.example"></iframe>'), '');
  assert.equal(sanitizeMinuteHtml('<p>a<img src=x onerror=alert(1)>b</p>'), '<p>ab</p>');
  assert.equal(sanitizeMinuteHtml('<style>body{display:none}</style><p>ok</p>'), '<p>ok</p>');
});

test('a link with a javascript: URL keeps the text and loses the link', () => {
  const cleaned = sanitizeMinuteHtml('<p><a href="javascript:alert(1)">click</a></p>');
  assert.equal(cleaned, '<p><a rel="noopener noreferrer nofollow" target="_blank">click</a></p>');
});

test('a real link is kept and marked safe to open', () => {
  const cleaned = sanitizeMinuteHtml('<p><a href="https://example.co.ke/minutes">the file</a></p>');
  assert.match(cleaned, /href="https:\/\/example\.co\.ke\/minutes"/);
  assert.match(cleaned, /rel="noopener noreferrer nofollow"/);
  assert.match(cleaned, /target="_blank"/);
});

test('an empty body stays empty', () => {
  assert.equal(sanitizeMinuteHtml(''), '');
  assert.equal(sanitizeMinuteHtml(undefined), '');
  assert.equal(sanitizeMinuteHtml('   '), '');
});
