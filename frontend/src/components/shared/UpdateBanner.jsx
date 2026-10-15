import { useEffect, useState } from 'react';
import { isNewVersion } from '../../utils/appVersion';

// "A new version is ready."
//
// The app is a single page that stays open for hours, often for days on a phone. A deploy replaces
// the files on the server, but the copy already running in the tab is the old one until it is
// reloaded — which is how an office ends up pressing a button that the server no longer
// understands.
//
// So this asks the server, now and then, which main script the front page points at, and compares
// it with the one running (utils/appVersion). It looks when the page comes back into view and once
// an hour, because nothing else would tell a tab that has been open for days. It never reloads on
// its own: that could throw away a payment half typed. In development there is no hashed script to
// compare, so it stays silent.
export default function UpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const running = Array.from(document.querySelectorAll('script[src]'))
      .map((el) => el.getAttribute('src'))
      .join('\n');
    // Nothing to compare against (a development page): stay quiet.
    if (!/\/assets\/index-/.test(running)) return undefined;

    let stopped = false;
    async function look() {
      try {
        const response = await fetch('/index.html', { cache: 'no-store' });
        if (!response.ok) return;
        const latestHtml = await response.text();
        if (!stopped && isNewVersion({ running, latestHtml })) setReady(true);
      } catch {
        // Offline, or the host is asleep: the next look will do.
      }
    }

    const timer = setInterval(look, 60 * 60 * 1000);
    function onVisible() {
      if (document.visibilityState === 'visible') look();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!ready) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-20 z-[55] mx-auto flex w-[calc(100%-2rem)] max-w-md items-center justify-between gap-3 rounded-xl border border-rule bg-surface px-4 py-3 shadow-lg md:bottom-6"
    >
      <p className="min-w-0 text-sm">A new version of the app is ready.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="min-h-11 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-white"
      >
        Refresh
      </button>
    </div>
  );
}
