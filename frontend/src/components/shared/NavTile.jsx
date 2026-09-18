import { Link } from 'react-router-dom';
import { warmRoute } from '../../services/prefetch';

// What a clickable navigation row looks like, in one place.
//
// Both admin navigations are lists of small destinations — the dashboard's "Go to"
// groups and the Settings rail — and both used to be rows of plain text inside a
// card: a label, and on a wider screen a hint beside it. A label sitting in a card
// reads as a caption, so the thing a person was meant to press looked like the one
// thing on the page that could not be pressed.
//
// So a row is a chip of its own: a border, a surface, a chevron pointing at what it
// does (right for a route, down for an anchor that scrolls this page), and a real
// 44px target with hover, press and keyboard-focus states. One definition, so the
// two navigations cannot drift apart again.
const ROW =
  'group flex min-h-11 w-full items-center gap-3 rounded-lg border border-rule bg-canvas px-3 py-2.5 text-left transition ' +
  'hover:border-primary/40 hover:bg-surface hover:shadow-sm ' +
  'active:scale-[0.99] active:bg-primary/10 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1';

function Chevron({ down = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-muted transition group-hover:text-primary ${
        down ? 'group-hover:translate-y-0.5' : 'group-hover:translate-x-0.5'
      }`}
    >
      <path d={down ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} />
    </svg>
  );
}

export default function NavTile({ to, href, label, hint, className = '' }) {
  const classes = `${ROW} ${className}`.trim();

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink group-hover:text-primary">
          {label}
        </span>
        {/* The one-line explanation is for the first visit and for the screens nobody
            opens twice a month. On a phone it is what makes the row read as a list
            item; in the multi-column layouts space is measured in characters, so the
            labels carry the meaning there. */}
        {hint && (
          <span className="mt-0.5 block text-xs leading-5 text-muted sm:hidden xl:block">
            {hint}
          </span>
        )}
      </span>
      <Chevron down={Boolean(href)} />
    </>
  );

  if (href) {
    return (
      <a href={href} className={classes}>
        {body}
      </a>
    );
  }

  return (
    <Link
      to={to}
      // Warm the destination on intent, exactly like the main navigation: hover on a
      // laptop, pointer-down on a phone.
      onMouseEnter={() => warmRoute(to)}
      onPointerDown={() => warmRoute(to)}
      className={classes}
    >
      {body}
    </Link>
  );
}
