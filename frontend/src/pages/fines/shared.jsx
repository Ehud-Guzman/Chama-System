import { useState } from 'react';
import { shortDate, money } from '../../utils/format';
import { sourceLabel } from '../../utils/finePayment';
import { Link } from 'react-router-dom';

export const FILTERS = [
  { value: 'pending', label: 'Owed' },
  { value: 'settled', label: 'Cleared' },
  { value: 'all', label: 'All' },
  { value: 'voided', label: 'Voided' },
];

// One fine on the list: who, what for, what is left, and what can be done about it — with the
// payments made against it a tap away, so "has he paid?" is answered on the row.
export function FineRow({ fine: f, onPay, onVoid, onUndo }) {
  const [open, setOpen] = useState(false);
  const payments = f.payments || [];
  // Only payments keyed in by hand can be taken back; one taken out of a contribution is undone
  // by deleting that contribution.
  const undoable = (p) => !f.voided && p.source !== 'contribution';

  return (
    <li className="border-b border-rule last:border-b-0">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-medium">
            {f.memberId ? (
              <Link to={`/admin/members/${f.memberId}`} className="hover:underline">
                {f.memberName || 'Member'}
              </Link>
            ) : (
              f.memberName || 'Member'
            )}
            {f.issuedBy ? <span className="font-normal text-muted"> · issued by {f.issuedBy}</span> : null}
          </p>
          <p className="text-xs text-muted">
            {f.type || 'Fine'}
            {f.reason ? ` · ${f.reason}` : ''} · {shortDate(f.date)}
          </p>
          <p className="amount mt-1 text-xs text-muted">
            {money(f.amount)} issued
            {f.voided ? ' · voided, not owed' : f.remaining > 0 ? '' : ' · cleared'}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <p
            className={`amount text-sm font-semibold ${
              f.voided ? 'text-muted line-through' : f.remaining > 0 ? 'text-alert' : 'text-primary'
            }`}
          >
            {f.remaining > 0 || f.voided ? money(f.remaining) : 'Cleared'}
          </p>
          {!f.voided && f.remaining > 0 && <p className="text-[11px] text-muted">still owed</p>}
        </div>

        <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
          {!f.voided && f.remaining > 0 && (
            <button
              type="button"
              onClick={onPay}
              className="min-h-11 rounded-lg border border-primary px-4 text-sm font-semibold text-primary hover:bg-primary/5"
            >
              Pay
            </button>
          )}
          {payments.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted hover:text-ink"
            >
              Payments ({payments.length}) {open ? '▴' : '▾'}
            </button>
          )}
          {!f.voided && (
            <button
              type="button"
              onClick={onVoid}
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted hover:text-alert"
            >
              Void
            </button>
          )}
        </div>
      </div>

      {open && payments.length > 0 && (
        <ul className="space-y-1 border-t border-rule bg-canvas px-4 py-2">
          {payments.map((p) => (
            <li key={p.index} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span className="min-w-0 text-xs">
                <span className="amount font-medium">{money(p.amount)}</span>
                <span className="text-muted">
                  {' '}
                  · {shortDate(p.date)} · {sourceLabel(p.source)}
                </span>
              </span>
              {undoable(p) && (
                <button
                  type="button"
                  onClick={() => onUndo(p)}
                  className="min-h-11 rounded-lg px-2 text-xs font-medium text-muted hover:text-alert"
                >
                  Take back
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
