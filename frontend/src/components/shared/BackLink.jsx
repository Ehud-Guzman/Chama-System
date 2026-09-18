import { Link } from 'react-router-dom';

// One way back, for every screen that is not one of the five bottom-nav
// destinations.
//
// Every screen had grown its own version of this — "← Back to the ledger", "← All
// members", "← Members" — in three different sizes, and two of them were 16px lines
// of text, which is a 16px tap target. The app's own rule for a phone is that
// anything a finger is meant to hit is at least 44px, so this is one component:
// arrow and label together in a real target, with a hover and focus state so it
// reads as something you press rather than a line you happen to be able to click.
//
// `to` is always a destination, never `navigate(-1)`: a back button that goes
// wherever you came from is unpredictable — after a form submit or from a link
// somebody sent, "back" is not the screen you expect. Going to the parent screen is
// the same answer every time.
export default function BackLink({ to, children = 'Back', className = '' }) {
  return (
    <Link
      to={to}
      // -ml-2 keeps the label on the page's text column while the padding still
      // counts as part of the target.
      className={`-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:bg-primary/10 ${className}`.trim()}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-4 w-4 shrink-0"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}
