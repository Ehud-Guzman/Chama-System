// Has the app been deployed again since this page loaded?
//
// Vite names the main script after its contents (`/assets/index-DZHu3MdJ.js`), so a new build is a
// new name, and the page that names it — index.html — is always fetched fresh from the network. So
// "is there a new version?" is "does the index.html on the server point at a different main script
// than the one running here?". It does not depend on the service worker file changing, which it
// does not do when only the app's own code does.
//
// Pure: the HTML and the running script are passed in, so the rule is covered by
// test/appVersion.test.js without a browser or a network.

const MAIN_SCRIPT = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

// The main script's path in a piece of HTML, or null when there is none (a development page, an
// error page, a proxy's holding page).
export function mainScriptIn(html) {
  const found = MAIN_SCRIPT.exec(String(html || ''));
  return found ? found[0] : null;
}

// True only when both sides are known and different. Anything unclear is "no update": a banner that
// cried wolf over a captive-portal page would teach everybody to ignore the real one.
export function isNewVersion({ running, latestHtml }) {
  const latest = mainScriptIn(latestHtml);
  const current = mainScriptIn(running);
  return Boolean(latest && current && latest !== current);
}
