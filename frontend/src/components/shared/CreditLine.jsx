// Who built and runs this, for every screen that carries a credit: the members'
// page, the admin shell every role works inside, the sign-in card and the
// constitution. One home for the wording and the address, so the line can never
// drift into two spellings on two pages.
//
// The link opens in a new tab: a member who taps it is usually mid-lookup, and
// losing the page (and the number he just typed) to a credit line would be rude.
export default function CreditLine({ className = '' }) {
  return (
    <p className={`text-xs text-muted ${className}`.trim()}>
      Created and managed by{' '}
      <a
        href="https://glimmerink.co.ke/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        GlimmerInk Creations
      </a>
    </p>
  );
}
