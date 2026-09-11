import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from './navItems';
import { useAuth } from '../../context/AuthContext';

export default function BottomNav() {
  const { user } = useAuth();
  const items = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user?.role));

  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-rule bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {/* grid-cols count follows the item list so it stays balanced as roles add/remove items */}
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => (
          <li key={item.to} className="min-w-0">
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                `flex min-h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium transition ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted hover:text-muted/80'
                }`
              }
              aria-current={({ isActive }) => (isActive ? 'page' : undefined)}
            >
              <span className="[&>svg]:h-5 [&>svg]:w-5">{item.icon}</span>
              <span className="w-full truncate px-1 text-center">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}