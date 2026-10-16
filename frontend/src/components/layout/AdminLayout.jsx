import { useEffect, useState } from 'react';
import BottomNav from './BottomNav';
import IdleGuard from './IdleGuard';
import { Link, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import CreditLine from '../shared/CreditLine';
import { useAuth } from '../../context/AuthContext';
import { CHAMA_NAME } from '../../utils/branding';
import { readCollapsed, writeCollapsed } from '../../utils/sidebarPref';
import { MaintenanceBanner, PreviewBar } from './StatusBanners';
import OverrideProvider from '../control/OverrideProvider';

// A link to another screen's section (`/admin/settings#backup`) lands on the top of that screen:
// the router changes the page but does not scroll to the heading the link promised. The section
// is not on the page at the moment of the click (the screen is loaded as it opens), so it is looked
// for a few times before giving up.
function useScrollToHash() {
  const { hash, pathname } = useLocation();
  useEffect(() => {
    if (!hash) return undefined;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      let target = null;
      try {
        target = document.querySelector(hash);
      } catch {
        // Not a selector (a stray fragment): nothing to scroll to.
      }
      if (target) {
        target.scrollIntoView();
        clearInterval(timer);
      } else if (tries >= 20) {
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [hash, pathname]);
}

export default function AdminLayout({ children }) {
  const { user, logout } = useAuth();
  useScrollToHash();
  // Whether the desktop menu is folded to its icons. Held here, not in the sidebar, because the page
  // beside it has to make room (or give it back) in step with it; remembered in this browser.
  const [collapsed, setCollapsed] = useState(() => readCollapsed());
  function toggleSidebar() {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  }

  return (
    <div
      className={`min-h-dvh transition-[padding] duration-200 motion-reduce:transition-none ${
        collapsed ? 'md:pl-16' : 'md:pl-56'
      }`}
    >
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      {/* Mobile top bar: brand, the account screen and sign out (sidebar hidden).
          Sticky so signing out — or just knowing which screen you are on — does not
          mean scrolling back up a long member record. The top inset keeps the brand
          clear of the notch. "Account" is here rather than in the tab bar because
          every role needs it and only four tabs fit; it is where a secretary or a
          disciplinary officer changes his own password. */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-rule bg-surface px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden">
        <p className="min-w-0 truncate text-sm font-bold">{CHAMA_NAME}</p>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            to="/admin/account"
            className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-primary"
          >
            Account
          </Link>
          <button
            type="button"
            onClick={logout}
            className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted hover:bg-elevation"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-40 pt-6 md:max-w-6xl md:px-8 md:pb-10">
        <MaintenanceBanner />
        {children}

        {/* The credit goes at the foot of the page rather than in the sidebar: the
            sidebar is hidden on a phone, and this is the one place every role and
            every admin screen passes through. */}
        <CreditLine className="mt-10 border-t border-rule pt-6 text-center" />
      </main>
      <BottomNav />
      <PreviewBar />
      {/* Asks the super admin for a reason when a save runs into closed books. Nobody else is ever
          offered the way through, so nobody else loads the dialog. */}
      {user?.role === 'super_admin' && <OverrideProvider />}
      {/* Ends a session nobody is using, with a minute's warning. */}
      <IdleGuard />
    </div>
  );
}