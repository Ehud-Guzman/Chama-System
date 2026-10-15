import { useEffect, useRef, useState } from 'react';
import { useModal } from '../../hooks/useModal';
import { money } from '../../utils/format';
import Modal from '../shared/Modal';

// Same visual shell as ConfirmDialog, but collects a resignation reason —
// resignation is an explicit, reasoned admin action, not a plain deactivate.
//
// It also says what he is leaving with. Resigning changes nothing about what the group holds for a
// member or what he still owes in fines: the money stays in the books and the fines stay on his
// record, and nothing else would ever record what became of either. So when there is a figure on
// either side, the office has to write down how it was settled before the button works.
export default function ResignDialog({ open, memberName, held = 0, owed = 0, busy, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [settlement, setSettlement] = useState('');
  const [payout, setPayout] = useState('');
  const inputRef = useRef(null);
  const containerRef = useModal(open, onCancel, inputRef);

  useEffect(() => {
    if (open) {
      setReason('');
      setSettlement('');
      setPayout('');
    }
  }, [open]);

  if (!open) return null;

  const needsSettlement = held > 0 || owed > 0;
  const payoutValue = Number(String(payout).replace(/[,\s]/g, ''));
  const payoutOk = payout.trim() === '' || (Number.isFinite(payoutValue) && payoutValue >= 0);
  // A payout is itself the account of what became of his money, so it stands in for the note.
  const hasPayout = payout.trim() !== '' && payoutOk && payoutValue > 0;
  const ready = payoutOk && (!needsSettlement || hasPayout || settlement.trim().length >= 3);

  return (
    <Modal
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-label="Resign member"
      onBackdropClick={onCancel}
    >
      <div
        ref={containerRef}
        className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-xl bg-surface p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">Resign {memberName}?</h2>
        <p className="mt-2 text-sm text-muted">
          They're marked inactive and kept out of every member-facing list, so they no longer
          appear to anyone browsing. Their contribution history is kept, and from today nothing more
          is charged to them: no tea, no weeks counted as missed.
        </p>

        {needsSettlement && (
          <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
            <p className="font-semibold">Before he goes</p>
            <ul className="mt-1 space-y-0.5">
              <li>
                The group holds <span className="amount font-semibold">{money(held)}</span> for him.
              </li>
              <li>
                He owes <span className="amount font-semibold">{money(owed)}</span> in fines.
              </li>
            </ul>
            <p className="mt-2 text-xs text-muted">
              Resigning does not pay him out or clear his fines. Write down what was done, so the
              figure is not left with nobody able to say what became of it.
            </p>
            <label htmlFor="resign-payout" className="mt-3 block text-sm font-medium">
              Paid out to him now <span className="font-normal text-muted">(Ksh, if you have)</span>
            </label>
            <input
              id="resign-payout"
              type="text"
              inputMode="decimal"
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              placeholder="0"
              className="amount mt-1 h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm"
            />
            <p className="mt-1 text-xs text-muted">
              Recorded as the group spending that money today, so the group&apos;s balance drops by it on the
              day he leaves. Leave it empty if you have not paid him yet.
            </p>
            <label htmlFor="resign-settlement" className="mt-3 block text-sm font-medium">
              How was it settled?{hasPayout ? <span className="font-normal text-muted"> (optional with a payout)</span> : null}
            </label>
            <textarea
              id="resign-settlement"
              rows={2}
              value={settlement}
              onChange={(e) => setSettlement(e.target.value)}
              placeholder="e.g. Paid out Ksh 12,400 by M-Pesa on 3 Oct; fine taken from it"
              className="mt-1 w-full rounded-xl border border-rule bg-surface px-3 py-2 text-sm"
            />
          </div>
        )}

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
            onClick={() => onConfirm(reason, settlement.trim(), hasPayout ? payoutValue : undefined)}
            disabled={busy || !ready}
            className="min-h-11 flex-1 rounded-lg bg-alert px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Working…' : 'Resign'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
