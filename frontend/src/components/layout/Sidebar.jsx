import { Link, useLocation } from 'react-router-dom';
import { NAV_ITEMS } from './navItems';
import { HOME_GROUP, activeNavTo, groupNavItems } from './navGroups';
import { useAuth } from '../../context/AuthContext';
import { warmRoute } from '../../services/prefetch';
import { CHAMA_NAME_TOP, CHAMA_NAME_BOTTOM } from '../../utils/branding';

const ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

// A row in the foot of the panel (My account, Sign out): a label when the panel is open, the icon
// alone when it is folded. The name stays on the control either way, for a screen reader and as the
// tooltip a pointer gets over a bare icon.
const ACCOUNT_ICON = (
  <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
  </svg>
);
const SIGN_OUT_ICON = (
  <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export default function Sidebar({ collapsed = false, onToggle }) {
  const { user, logout } = useAuth();
  // Grouped, not a flat list: eleven rows in one column said nothing about what belongs
  // with what. The bottom bar is unaffected — it still takes the first four destinations
  // as its tabs, from the same array (see navItems).
  const groups = groupNavItems(NAV_ITEMS, user?.role);
  // One destination is lit: the most specific one for the page on screen (see activeNavTo).
  const { pathname } = useLocation();
  const activeTo = activeNavTo(groups.flatMap((group) => group.items), pathname);

  // The same row shape open or folded; only what is inside it changes.
  const rowClass = (active) =>
    `flex min-h-11 items-center rounded-lg text-sm font-medium whitespace-nowrap ${
      collapsed ? 'justify-center px-0' : 'gap-3 px-3'
    } ${active ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-canvas'}`;

  return (
    <aside
      aria-label="Sidebar"
      className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-rule bg-surface pl-[env(safe-area-inset-left)] transition-[width] duration-200 motion-reduce:transition-none md:flex ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      <div
        className={`flex shrink-0 items-center border-b border-rule ${
          collapsed ? 'justify-center px-2 py-3' : 'justify-between gap-2 px-5 py-5'
        }`}
      >
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-widest text-muted">
              {CHAMA_NAME_TOP}
            </p>
            <p className="truncate font-bold">{CHAMA_NAME_BOTTOM}</p>
          </div>
        )}
        {/* The fold. It stays in the same corner folded or open, so it is always where the
            pointer left it. `aria-expanded` is the state a screen reader announces. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
          title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
        >
          <svg viewBox="0 0 24 24" {...ICON} className="h-5 w-5" aria-hidden="true">
            {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
          </svg>
        </button>
      </div>
      {/* The list scrolls on its own, and only the list.
          An admin now has twelve destinations, and twelve rows are taller than a laptop
          screen. This panel is fixed to the viewport, so without a scroll of its own the
          overflow pushed everything below it (My account, then Sign out) past the bottom
          edge, where scrolling the page does not reach it: the page scrolls, the panel
          does not. `min-h-0` is what lets a flex child shrink far enough to scroll at all.
          Sideways overflow is hidden so a label does not peek out while the panel animates. */}
      <nav
        aria-label="Main"
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-4 ${
          collapsed ? 'px-2' : 'px-3'
        }`}
      >
        {groups.map((group, index) => (
          <div key={group.title} className={index === 0 ? '' : collapsed ? 'mt-2' : 'mt-4'}>
            {/* The heading is the only thing separating the sections, so it is small, quiet
                and aligned with the row labels rather than with the panel edge. Folded, there
                is no room for words: a rule between the sections keeps them apart instead. */}
            {group.title !== HOME_GROUP &&
              (collapsed ? (
                <div className="mx-2 mb-2 border-t border-rule" aria-hidden="true" />
              ) : (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-muted">
                  {group.title}
                </p>
              ))}
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={item.to === activeTo ? 'page' : undefined}
                    // A folded row is only an icon, so the name rides on the link itself.
                    title={collapsed ? item.label : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    // Warm the destination while the pointer is over the link: the
                    // page's chunk is already loaded, and on the two screens that
                    // show the ledger its figures are already in the cache, so the
                    // click has nothing left to wait for.
                    onMouseEnter={() => warmRoute(item.to)}
                    onPointerDown={() => warmRoute(item.to)}
                    className={rowClass(item.to === activeTo)}
                  >
                    <span className="[&>svg]:h-5 [&>svg]:w-5">{item.icon}</span>
                    {!collapsed && item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {/* Pinned to the foot of the panel and never scrolled away: signing out is not a
          destination to go looking for. */}
      <div className={`shrink-0 border-t border-rule py-4 ${collapsed ? 'px-2' : 'px-5'}`}>
        {!collapsed && (
          <>
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </>
        )}
        {/* The account screen is a destination like any other, but it does not belong
            in the list above: every role has it, and it is not part of the day's work. */}
        <Link
          to="/admin/account"
          aria-current={pathname === '/admin/account' ? 'page' : undefined}
          title={collapsed ? 'My account' : undefined}
          aria-label={collapsed ? 'My account' : undefined}
          className={`${collapsed ? '' : 'mt-3 '}${rowClass(pathname === '/admin/account')}`}
        >
          {collapsed ? <span className="[&>svg]:h-5 [&>svg]:w-5">{ACCOUNT_ICON}</span> : 'My account'}
        </Link>
        <button
          type="button"
          onClick={logout}
          title={collapsed ? 'Sign out' : undefined}
          aria-label={collapsed ? 'Sign out' : undefined}
          className={`mt-1 flex min-h-11 w-full items-center justify-center rounded-lg text-sm font-medium hover:bg-canvas ${
            collapsed ? 'text-muted' : 'border border-rule'
          }`}
        >
          {collapsed ? <span className="[&>svg]:h-5 [&>svg]:w-5">{SIGN_OUT_ICON}</span> : 'Sign out'}
        </button>
      </div>
    </aside>
  );
}
