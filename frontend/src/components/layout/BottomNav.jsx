import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_ITEMS } from './navItems';
import { useAuth } from '../../context/AuthContext';
import { useModal } from '../../hooks/useModal';
import { warmRoute } from '../../services/prefetch';

// A bottom bar fits four destinations plus a "More" tab before labels start
// truncating on a 360px phone (8 items => ~45px a column, but "Dashboard" needs
// ~50px). The first four visible items become the tabs, in NAV_ITEMS order, so
// the busiest pages are simply listed first in navItems and that ordering stays
// in one place instead of being duplicated here.
//
// The overflow only becomes a More tab when hiding it actually saves room: with
// five or fewer destinations everything shows, because a More tab hiding a
// single item is worse than one extra tab.
const TAB_LIMIT = 4;

const CELL =
  'flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition';

export default function BottomNav() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  function closeMore() {
    setMoreOpen(false);
  }

  const sheetRef = useModal(moreOpen, closeMore);

  const visible = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user?.role));
  const split = visible.length > TAB_LIMIT + 1;
  const tabs = split ? visible.slice(0, TAB_LIMIT) : visible;
  const overflow = split ? visible.slice(TAB_LIMIT) : [];
  const columns = tabs.length + (overflow.length ? 1 : 0);

  // The More tab takes the active colour whenever the page on screen is one of
  // the hidden ones, so the bar still shows where the admin is.
  const moreActive = overflow.some((item) => item.to === pathname);

  return (
    <>
      <nav
        aria-label="Main navigation"
        // z-30, deliberately: the bar must sit *under* every dialog, menu and toast.
        // It used to share z-50 with them, and because it is the last element in this
        // shell it won the tie and painted over the bottom sheets it was meant to
        // stay behind (their Cancel/Confirm row is in the bottom 60px of the screen).
        className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
      >
        {/* Column count follows the rendered cells so the row stays balanced as
            roles add or remove destinations */}
        <ul
          className="grid"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {tabs.map((item) => (
            <li key={item.to} className="min-w-0">
              {/* NavLink already applies aria-current="page" when it is active */}
              <NavLink
                to={item.to}
                // A thumb lands before it lifts: warming on pointer-down gives
                // the chunk (and the ledger) a head start the tap can't.
                onPointerDown={() => warmRoute(item.to)}
                className={({ isActive }) =>
                  `${CELL} ${isActive ? 'text-primary' : 'text-muted hover:text-muted/80'}`
                }
              >
                <span className="[&>svg]:h-5 [&>svg]:w-5">{item.icon}</span>
                <span className="w-full truncate px-1 text-center">{item.label}</span>
              </NavLink>
            </li>
          ))}

          {overflow.length > 0 && (
            <li className="min-w-0">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-expanded={moreOpen}
                aria-haspopup="dialog"
                className={`${CELL} w-full ${
                  moreActive ? 'text-primary' : 'text-muted hover:text-muted/80'
                }`}
              >
                <span className="[&>svg]:h-5 [&>svg]:w-5" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <circle cx="5" cy="12" r="1" />
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="19" cy="12" r="1" />
                  </svg>
                </span>
                <span className="w-full truncate px-1 text-center">More</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      {/* Sits above the bar and keeps its rows full-width, so the pages that
          don't earn a permanent tab stay one thumb-reach away instead of being
          squeezed into a scrollable overflow strip. */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="More pages"
          onClick={(e) => e.target === e.currentTarget && closeMore()}
        >
          <div
            ref={sheetRef}
            className="w-full max-w-md rounded-t-2xl bg-surface pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-xl"
          >
            <p className="border-b border-rule px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
              More
            </p>

            <ul className="p-2">
              {overflow.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={closeMore}
                    onPointerDown={() => warmRoute(item.to)}
                    className={({ isActive }) =>
                      `flex min-h-14 items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                        isActive ? 'bg-primary/10 text-primary' : 'text-ink'
                      }`
                    }
                  >
                    <span className="[&>svg]:h-5 [&>svg]:w-5">{item.icon}</span>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>

            <div className="px-2 pb-1">
              <button
                type="button"
                onClick={closeMore}
                className="min-h-12 w-full rounded-lg border border-rule text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
