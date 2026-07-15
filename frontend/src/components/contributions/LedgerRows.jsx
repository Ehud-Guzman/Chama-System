import { money, shortDate, shortDateTime, isSameCalendarDay, METHOD_LABELS } from '../../utils/format';

// Admin ledger list. Each row: date + method | member (optional) | amount, with
// edit/delete actions when callbacks are provided.
export default function LedgerRows({ contributions, showMember = false, onEdit, onDelete }) {
  if (contributions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-rule px-5 py-10 text-center">
        <p className="text-sm text-muted">No contributions recorded.</p>
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
      {contributions.map((c) => (
        <li
          key={c._id}
          className="flex items-center gap-3 border-b border-rule px-4 py-3 last:border-b-0"
        >
          <div className="min-w-0 flex-1">
            {showMember && (
              <p className="truncate text-sm font-semibold">{c.memberId?.name || 'Unknown member'}</p>
            )}
            <p className={`text-sm ${showMember ? 'text-muted' : 'font-medium'}`}>
              {shortDate(c.date)}
              <span className="text-muted">
                {c.typeId?.name ? ` · ${c.typeId.name}` : ''} · {METHOD_LABELS[c.method] || c.method}
              </span>
            </p>
            {c.note && <p className="truncate text-xs text-muted">{c.note}</p>}
            {c.typeId?.isGroupFund && (
              <p className="truncate text-xs text-muted">Group fund — not counted in personal total</p>
            )}
            {c.createdAt && !isSameCalendarDay(c.date, c.createdAt) && (
              <p className="truncate text-xs text-muted">Logged {shortDateTime(c.createdAt)}</p>
            )}
          </div>
          <p className="amount shrink-0 text-right font-semibold">{money(c.amount)}</p>
          {(onEdit || onDelete) && (
            <div className="flex shrink-0 gap-1">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(c)}
                  aria-label={`Edit contribution of ${money(c.amount)} on ${shortDate(c.date)}`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-canvas"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
                  </svg>
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(c)}
                  aria-label={`Delete contribution of ${money(c.amount)} on ${shortDate(c.date)}`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-alert"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
