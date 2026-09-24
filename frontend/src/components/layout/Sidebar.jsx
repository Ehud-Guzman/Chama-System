import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from './navItems';
import { groupNavItems } from './navGroups';
import { useAuth } from '../../context/AuthContext';
import { warmRoute } from '../../services/prefetch';
import { CHAMA_NAME_TOP, CHAMA_NAME_BOTTOM } from '../../utils/branding';

export default function Sidebar() {
  const { user, logout } = useAuth();
  // Grouped, not a flat list: eleven rows in one column said nothing about what belongs
  // with what. The bottom bar is unaffected — it still takes the first four destinations
  // as its tabs, from the same array (see navItems).
  const groups = groupNavItems(NAV_ITEMS, user?.role);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-rule bg-surface pl-[env(safe-area-inset-left)] md:flex">
      <div className="shrink-0 border-b border-rule px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          {CHAMA_NAME_TOP}
        </p>
        <p className="font-bold">{CHAMA_NAME_BOTTOM}</p>
      </div>
      {/* The list scrolls on its own, and only the list.
          An admin now has eleven destinations — the Fines desk and the spending screen
          joined the nine — and eleven rows are taller than a laptop screen. This panel is
          fixed to the viewport, so without a scroll of its own the overflow pushed
          everything below it (My account, then Sign out) past the bottom edge, where
          scrolling the page does not reach it: the page scrolls, the panel does not.
          `min-h-0` is what lets a flex child shrink far enough to scroll at all. */}
      <nav
        aria-label="Main"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4"
      >
        {groups.map((group, index) => (
          <div key={group.title} className={index === 0 ? '' : 'mt-4'}>
            {/* The heading is the only thing separating the sections, so it is small, quiet
                and aligned with the row labels rather than with the panel edge. */}
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-muted">
              {group.title}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    // Warm the destination while the pointer is over the link: the
                    // page's chunk is already loaded, and on the two screens that
                    // show the ledger its figures are already in the cache, so the
                    // click has nothing left to wait for.
                    onMouseEnter={() => warmRoute(item.to)}
                    onPointerDown={() => warmRoute(item.to)}
                    className={({ isActive }) =>
                      `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                        isActive ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-canvas'
                      }`
                    }
                  >
                    <span className="[&>svg]:h-5 [&>svg]:w-5">{item.icon}</span>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {/* Pinned to the foot of the panel and never scrolled away: signing out is not a
          destination to go looking for. */}
      <div className="shrink-0 border-t border-rule px-5 py-4">
        <p className="truncate text-sm font-medium">{user?.name}</p>
        <p className="truncate text-xs text-muted">{user?.email}</p>
        {/* The account screen is a destination like any other, but it does not belong
            in the list above: every role has it, and it is not part of the day's work. */}
        <NavLink
          to="/admin/account"
          className={({ isActive }) =>
            `mt-3 flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${
              isActive ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-canvas'
            }`
          }
        >
          My account
        </NavLink>
        <button
          type="button"
          onClick={logout}
          className="mt-1 min-h-11 w-full rounded-lg border border-rule text-sm font-medium hover:bg-canvas"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
