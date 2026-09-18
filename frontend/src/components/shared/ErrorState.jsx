// One shape for "this did not load", used wherever a screen's data fetch fails.
// The point is the button underneath it: on a phone in a moving matatu a failed
// fetch is usually the network, not the app, and the member should not have to
// reload the whole page to find out.
export default function ErrorState({
  title = 'Could not load this',
  message,
  onRetry,
  busy = false,
  retryLabel = 'Try again',
}) {
  return (
    <div
      className="rounded-xl border border-dashed border-alert/40 bg-surface px-5 py-8 text-center"
      role="alert"
    >
      <p className="font-semibold">{title}</p>
      {message && (
        <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-muted">{message}</p>
      )}

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-rule px-4 text-sm font-semibold text-primary disabled:opacity-60"
        >
          {busy ? 'Trying…' : retryLabel}
        </button>
      )}
    </div>
  );
}
