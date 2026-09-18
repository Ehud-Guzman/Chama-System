import { useRef } from 'react';
import { useModal } from '../../hooks/useModal';
import Modal from './Modal';

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);
  const containerRef = useModal(open, onCancel, confirmRef);

  if (!open) return null;

  return (
    <Modal
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onBackdropClick={onCancel}
    >
      <div
        ref={containerRef}
        className="flex max-h-[85dvh] w-full max-w-sm flex-col rounded-xl bg-surface p-5 shadow-xl"
      >
        <h2 className="shrink-0 text-base font-semibold">{title}</h2>
        {/* The body scrolls rather than pushing the actions off a short screen or
            behind the on-screen keyboard, so Cancel/Confirm stay reachable
            whatever the message length. shrink-0 keeps them at full height. */}
        {body && <p className="mt-2 overflow-y-auto text-sm text-muted">{body}</p>}
        <div className="mt-5 flex shrink-0 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-lg border border-rule bg-surface px-4 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={onConfirm}
            disabled={busy}
            className={`min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-60 ${
              danger ? 'bg-alert' : 'bg-primary'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
