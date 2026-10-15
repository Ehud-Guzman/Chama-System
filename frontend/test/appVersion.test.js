// Spotting that the app has been deployed again.
import test from 'node:test';
import assert from 'node:assert/strict';

import { mainScriptIn, isNewVersion } from '../src/utils/appVersion.js';

const page = (script) =>
  `<!doctype html><html><head><script type="module" crossorigin src="${script}"></script></head><body></body></html>`;

test('the main script is read out of the page', () => {
  assert.equal(mainScriptIn(page('/assets/index-DZHu3MdJ.js')), '/assets/index-DZHu3MdJ.js');
  assert.equal(mainScriptIn('<html>nothing here</html>'), null);
  assert.equal(mainScriptIn(''), null);
  assert.equal(mainScriptIn(undefined), null);
});

test('a different main script is a new version; the same one is not', () => {
  const running = page('/assets/index-aaaaaaaa.js');
  assert.equal(isNewVersion({ running, latestHtml: page('/assets/index-bbbbbbbb.js') }), true);
  assert.equal(isNewVersion({ running, latestHtml: page('/assets/index-aaaaaaaa.js') }), false);
});

test('anything unclear is not an update', () => {
  const running = page('/assets/index-aaaaaaaa.js');
  assert.equal(isNewVersion({ running, latestHtml: '<html>Please log in to the wifi</html>' }), false);
  assert.equal(isNewVersion({ running: '<html>dev page</html>', latestHtml: page('/assets/index-bbbbbbbb.js') }), false);
  assert.equal(isNewVersion({ running, latestHtml: '' }), false);
});

test('other bundles with a similar name are not the main one', () => {
  assert.equal(mainScriptIn(page('/assets/indexes-abc.js')), null);
  assert.equal(mainScriptIn(page('/assets/vendor-abc.js')), null);
});
