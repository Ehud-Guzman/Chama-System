import { useCallback, useEffect, useRef, useState } from 'react';
import { setOverrideHandler } from '../../services/api';
import { useModal } from '../../hooks/useModal';
import Modal from '../shared/Modal';

// The question the super admin is asked when a save hits a closed period.
//
// The API says "the books are closed up to 4 Oct, and you may go through with a reason"; this is
// where the reason is given. It is mounted once, high in the tree, and registers itself with the
// API client — so every screen that saves money gets the prompt without knowing it exists, and a
// treasurer, who is never offered the override, never sees it.
//
// The reason is not decoration: it is sent with the retried request, kept in the audit trail next
// to the change it allowed, and read by whoever asks later why a closed month was touched.
export const MIN_REASON = 5;

export default function OverrideProvider({ children }) {
  const [ask, setAsk] = useState(null); // { message, lockedThrough, resolve }
  const [reason, setReason] = useState('');
  const inputRef = useRef(null);
  const resolveRef = useRef(null);

  const settle = useCallback((value) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setAsk(null);
    setReason('');
  }, []);

  useEffect(() => {
    return setOverrideHandler(
      (details) =>
        new Promise((resolve) => {
          // Only one question at a time: a second locked save while one is open is declined.
          if (resolveRef.current) {
            resolve(null);
            return;
          }
          resolveRef.current = resolve;
          setAsk(details);
        })
    );
  }, []);

  const containerRef = useModal(Boolean(ask), () => settle(null), inputRef);
  const ready = reason.trim().length >= MIN_REASON;

  return (
    <>
      {children}
      {ask && (
        <Modal
          className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4"
          role="dialog"
          aria-modal="true"
          aria-label="Change closed books"
          onBackdropClick={() => settle(null)}
        >
          <form
            ref={containerRef}
            onSubmit={(event) => {
              event.preventDefault();
              if (ready) settle(reason.trim());
            }}
            className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-xl bg-surface p-5 shadow-xl"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-alert">Closed books</p>
            <h2 className="mt-1 shrink-0 text-base font-semibold">This money is in a closed period</h2>
            <p className="mt-2 overflow-y-auto text-sm leading-6 text-muted">
              {ask.message ||
                `The books are closed up to ${ask.lockedThrough}.`}{' '}
              Only you can change it, and the reason you give is kept in the audit trail beside the
              change.
            </p>
            <label htmlFor="override-reason" className="mt-4 text-sm font-medium">
              Why is this being changed?
            </label>
            <textarea
              id="override-reason"
              ref={inputRef}
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Receipt 0412 was keyed as 500, it was 600"
              className="mt-1 w-full rounded-lg border border-rule bg-canvas px-3 py-2 text-sm"
            />
            <div className="mt-5 flex shrink-0 gap-3">
              <button
                type="button"
                onClick={() => settle(null)}
                className="min-h-11 flex-1 rounded-lg border border-rule bg-surface px-4 text-sm font-medium"
              >
                Leave it closed
              </button>
              <button
                type="submit"
                disabled={!ready}
                className="min-h-11 flex-1 rounded-lg bg-alert px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                Change it
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
