import { money, shortDate } from '../../utils/format';

// Pending/settled fines for one member. Pass `onVoid` (admin only) to show a
// void button per pending fine; omit it for the read-only public passbook view.
export default function FinesPanel({ fines, onVoid }) {
  if (!fines || (fines.pending.length === 0 && fines.settled.length === 0)) return null;

  return (
    <section className="rounded-xl border border-rule bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">Fines</p>
        {fines.totalOwed > 0 && (
          <p className="amount text-sm font-semibold text-alert">{money(fines.totalOwed)} owed</p>
        )}
      </div>

      {fines.pending.length > 0 && (
        <ul className="mt-3 divide-y divide-rule">
          {fines.pending.map((f, i) => (
            <li key={f._id || i} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {f.typeId?.name || f.type} · {shortDate(f.date)}
                </p>
                {f.reason && <p className="truncate text-xs text-muted">{f.reason}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="amount text-sm font-semibold text-alert">{money(f.remaining)}</span>
                {onVoid && (
                  <button
                    type="button"
                    onClick={() => onVoid(f)}
                    className="min-h-9 rounded-lg border border-rule px-2 text-xs font-medium"
                  >
                    Void
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {fines.settled.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-muted">
            Settled fines ({fines.settled.length})
          </summary>
          <ul className="mt-2 divide-y divide-rule">
            {fines.settled.map((f, i) => (
              <li key={f._id || i} className="flex items-center justify-between gap-3 py-2 text-xs text-muted">
                <span className="truncate">
                  {f.typeId?.name || f.type} · {shortDate(f.date)}
                </span>
                <span className="amount shrink-0">{money(f.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
