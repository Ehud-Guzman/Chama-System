import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from './navItems';
import { useAuth } from '../../context/AuthContext';

export default function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-rule bg-surface md:flex">
      <div className="border-b border-rule px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          Contribution
        </p>
        <p className="font-bold">Manager</p>
      </div>
      <nav aria-label="Main" className="flex-1 px-3 py-4">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                    isActive ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-canvas'
                  }`
                }
              >
                <span className="h-5 w-5">{item.icon}</span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-rule px-5 py-4">
        <p className="truncate text-sm font-medium">{user?.name}</p>
        <p className="truncate text-xs text-muted">{user?.email}</p>
        <button
          type="button"
          onClick={logout}
          className="mt-3 min-h-11 w-full rounded-lg border border-rule text-sm font-medium hover:bg-canvas"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
