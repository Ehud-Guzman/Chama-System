import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from './navItems';

export default function BottomNav() {
  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-rule bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
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
              <span className="h-5 w-5">{item.icon}</span>
              <span className="text-center">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}