import BottomNav from './BottomNav';
import Sidebar from './Sidebar';
import CreditLine from '../shared/CreditLine';
import { useAuth } from '../../context/AuthContext';
import { CHAMA_NAME } from '../../utils/branding';

export default function AdminLayout({ children }) {
  const { logout } = useAuth();

  return (
    <div className="min-h-dvh md:pl-56">
      <Sidebar />
      {/* Mobile top bar: brand + sign out (sidebar hidden). Sticky so signing out —
          or just knowing which screen you are on — does not mean scrolling back up
          a long member record. The top inset keeps the brand clear of the notch. */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-rule bg-surface px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden">
        <p className="min-w-0 truncate text-sm font-bold">{CHAMA_NAME}</p>
        <button
          type="button"
          onClick={logout}
          className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-muted hover:bg-elevation"
        >
          Sign out
        </button>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-40 pt-6 md:max-w-6xl md:px-8 md:pb-10">
        {children}

        {/* The credit goes at the foot of the page rather than in the sidebar: the
            sidebar is hidden on a phone, and this is the one place every role and
            every admin screen passes through. */}
        <CreditLine className="mt-10 border-t border-rule pt-6 text-center" />
      </main>
      <BottomNav />
    </div>
  );
}