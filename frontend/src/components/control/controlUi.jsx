import { useRef, useState } from 'react';
import { useModal } from '../../hooks/useModal';
import Modal from '../shared/Modal';

// The small pieces every part of the Control Room is built from, in one place so the eight panels
// look and behave like one screen.

// A panel: a titled card with an optional intro and an optional control at the right.
export function Panel({ id, title, intro, right, children, tone }) {
  return (
    <section
      id={id}
      className={`scroll-mt-24 min-w-0 rounded-xl border bg-surface p-4 sm:p-5 ${
        tone === 'danger' ? 'border-alert/40' : 'border-rule'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* A basis, not just flex-1: on a phone the control beside the title would otherwise squeeze
            the intro into a sliver; with it, the control drops below the text instead. */}
        <div className="min-w-0 flex-1 basis-64">
          <h2 className={`text-base font-semibold ${tone === 'danger' ? 'text-alert' : ''}`}>{title}</h2>
          {intro && <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{intro}</p>}
        </div>
        {right}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

const PILL_TONES = {
  good: 'bg-primary/10 text-primary',
  bad: 'bg-alert/10 text-alert',
  warn: 'bg-accent/10 text-accent',
  info: 'bg-primary/10 text-primary',
  quiet: 'border border-rule text-muted',
};

export function Pill({ tone = 'quiet', children }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5 ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

// An on/off switch with its words beside it. A real `role="switch"` button so a screen reader says
// "on"/"off", and the whole row is the target (44px high) because the little knob alone is not.
export function Toggle({ checked, onChange, disabled, label, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-rule bg-canvas px-3 py-2 text-left transition hover:bg-surface disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-5 text-muted">{hint}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-primary' : 'bg-rule'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? 'left-5.5' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

export function Field({ label, htmlFor, hint, children }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs leading-5 text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass = 'h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm';
export const buttonClass =
  'min-h-11 rounded-lg border border-rule bg-surface px-4 text-sm font-medium transition hover:bg-elevation disabled:opacity-50';
export const primaryButtonClass =
  'min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition disabled:opacity-50';
export const dangerButtonClass =
  'min-h-11 rounded-lg bg-alert px-4 text-sm font-semibold text-white transition disabled:opacity-50';

// "Are you sure?" for the actions that cannot be taken back — with, as asked for, a reason, a typed
// word and the password. All three are checked again on the server; here they only keep the button
// shut until there is something to send.
//
//   needs={{ reason: 'Why?', phrase: 'RESTORE', password: true }}
//   onConfirm({ reason, phrase, password }) → a promise; the dialog stays open and shows the
//   server's refusal if it rejects, so a mistyped password is corrected in place.
export function ConfirmWith({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  needs = {},
  onConfirm,
  onCancel,
}) {
  const [reason, setReason] = useState('');
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef(null);
  const containerRef = useModal(open, onCancel, firstRef);

  if (!open) return null;

  const ready =
    (!needs.reason || reason.trim().length >= (needs.minReason || 3)) &&
    (!needs.phrase || phrase.trim().toLowerCase() === needs.phrase.toLowerCase()) &&
    (!needs.password || password.length > 0);

  async function submit(event) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm({ reason: reason.trim(), phrase: phrase.trim(), password });
      setReason('');
      setPhrase('');
      setPassword('');
    } catch (err) {
      setError(err?.message || 'That did not work.');
      // A wrong password is retyped; the rest of what was typed is kept.
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onBackdropClick={onCancel}
    >
      <form
        ref={containerRef}
        onSubmit={submit}
        className="flex max-h-[88dvh] w-full max-w-md flex-col overflow-y-auto rounded-xl bg-surface p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        {body && <div className="mt-2 text-sm leading-6 text-muted">{body}</div>}

        <div className="mt-4 space-y-3">
          {needs.reason && (
            <Field label={needs.reasonLabel || 'Why?'} htmlFor="cw-reason">
              <textarea
                id="cw-reason"
                ref={needs.reason ? firstRef : null}
                rows={2}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-lg border border-rule bg-canvas px-3 py-2 text-sm"
              />
            </Field>
          )}
          {needs.phrase && (
            <Field label={`Type ${needs.phrase} to confirm`} htmlFor="cw-phrase">
              <input
                id="cw-phrase"
                ref={!needs.reason ? firstRef : null}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoComplete="off"
                className={inputClass}
              />
            </Field>
          )}
          {needs.password && (
            <Field label="Your password" htmlFor="cw-password">
              <input
                id="cw-password"
                ref={!needs.reason && !needs.phrase ? firstRef : null}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className={inputClass}
              />
            </Field>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-alert/40 bg-alert/5 px-3 py-2 text-sm text-alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex shrink-0 gap-3">
          <button type="button" onClick={onCancel} className={`${buttonClass} flex-1`}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready || busy}
            className={`${danger ? dangerButtonClass : primaryButtonClass} flex-1`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
