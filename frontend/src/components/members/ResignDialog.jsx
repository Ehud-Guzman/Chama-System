import { useEffect, useRef, useState } from 'react';

// Same visual shell as ConfirmDialog, but collects a resignation reason —
// resignation is an explicit, reasoned admin action, not a plain deactivate.
export default function ResignDialog({ open, memberName, busy, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Resign member"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl">
        <h2 className="text-base font-semibold">Resign {memberName}?</h2>
        <p className="mt-2 text-sm text-muted">
          They're marked inactive and hidden from the public directory, but will appear on the
          public resigned-members list. Their contribution history is kept.
        </p>
        <label htmlFor="resign-reason" className="mt-4 block text-sm font-medium">
          Reason <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="resign-reason"
          ref={inputRef}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-xl border border-rule px-3 py-2 text-sm"
        />
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-lg border border-rule bg-surface px-4 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={busy}
            className="min-h-11 flex-1 rounded-lg bg-alert px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Working…' : 'Resign'}
          </button>
        </div>
      </div>
    </div>
  );
}
