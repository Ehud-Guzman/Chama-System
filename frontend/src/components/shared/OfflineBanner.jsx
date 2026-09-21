import { useEffect, useState } from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { subscribe, flush } from '../../services/offlineQueue';
import api from '../../services/api';

// A thin band at the top of whatever is on screen. It sits in the normal flow rather than floating
// over it, so it can never cover the page it is warning about, and it scrolls away with the rest
// once it has been read.
//
// It used to say "Anything you send now will not be saved", and that was true. It is not any more:
// the ledger's writes go into the outbox and are sent when the signal returns, and a banner that
// kept saying they were lost would push the treasurer into re-entering a payment that is already
// queued — the exact double-entry the outbox exists to prevent. So it now says which is which.
export default function OfflineBanner() {
  const online = useOnlineStatus();
  const [queued, setQueued] = useState(0);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  // The count comes from the store, never from a copy kept in this component: the number on screen
  // has to be the number of things actually waiting.
  useEffect(() => subscribe(setQueued), []);

  useEffect(() => {
    if (!online || queued === 0 || sending) return;
    setSending(true);
    flush(api)
      .then((outcome) => {
        // Only reported when there is something to report. A flush that simply sent the queue and
        // emptied it needs no announcement — the count disappearing says it.
        if (outcome.rejected.length > 0 || outcome.duplicates > 0 || outcome.stopped) setResult(outcome);
      })
      .catch(() => {})
      .finally(() => setSending(false));
  }, [online, queued, sending]);

  if (online) {
    // Back online, with something to say about what happened while it was gone: a refusal that has
    // been thrown away is the thing an admin most needs to see, because it will never be retried.
    if (!result) return null;
    const rejected = result.rejected.length;
    return (
      <div className="bg-surface px-4 py-2 text-sm" role="status" aria-live="polite">
        <p className="text-center font-medium">
          {result.duplicates > 0 && `${result.duplicates} entry already went through. `}
          {rejected > 0
            ? `${rejected} queued ${rejected === 1 ? 'entry' : 'entries'} could not be saved and will not be retried.`
            : result.stopped
              ? 'Some queued entries are still waiting to be sent.'
              : 'Queued entries saved.'}
        </p>
        {rejected > 0 && (
          <ul className="mx-auto mt-1 max-w-2xl list-disc pl-5 text-xs text-muted">
            {result.rejected.map((entry) => (
              <li key={`${entry.label}-${entry.message}`}>
                {entry.label || 'An entry'}: {entry.message}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setResult(null)}
          className="mx-auto mt-1 block min-h-11 text-xs font-semibold underline underline-offset-2"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <p
      role="status"
      aria-live="polite"
      className="bg-alert px-4 py-2 text-center text-sm font-medium text-white"
    >
      You are offline.{' '}
      {queued > 0
        ? `${queued} ${queued === 1 ? 'entry is' : 'entries are'} waiting to be sent.`
        : 'Ledger entries you save now will be sent when you are back.'}
    </p>
  );
}
