import BottomNav from './BottomNav';
import Sidebar from './Sidebar';
import { useAuth } from '../../context/AuthContext';

export default function AdminLayout({ children }) {
  const { logout } = useAuth();

  return (
    <div className="min-h-dvh md:pl-56">
      <Sidebar />
      {/* Mobile top bar: brand + sign out (sidebar hidden) */}
      <header className="flex items-center justify-between border-b border-rule bg-surface px-4 py-3 md:hidden">
        <p className="text-sm font-bold">Contribution Manager</p>
        <button
          type="button"
          onClick={logout}
          className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted"
        >
          Sign out
        </button>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 md:max-w-6xl md:px-8 md:pb-10">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
