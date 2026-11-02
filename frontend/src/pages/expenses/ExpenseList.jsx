import { money, shortDate } from '../../utils/format';
import { PencilIcon, TrashIcon } from '../../components/shared/icons';

export default function ExpenseList({ editingId, expenses, setDeleting, startEdit, totalSpent }) {
  return (
    <section className="overflow-hidden rounded-xl border border-rule bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <h2 className="text-sm font-semibold">Every expense ({expenses.length})</h2>
        <p className="amount text-sm font-semibold text-alert">
          {money(totalSpent)} spent in total
        </p>
      </div>

      {expenses.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">
          Nothing has been spent from the funds yet.
        </p>
      ) : (
        <ul>
          {expenses.map((x) => (
            <li
              key={x.id}
              className={`flex items-start gap-3 border-b border-rule px-4 py-3 last:border-b-0 ${
                editingId === x.id ? 'bg-primary/5' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {x.description || 'Expense'}
                  <span className="text-muted">
                    {' · '}
                    {x.fund} · {shortDate(x.date)}
                    {x.reference ? ` · ${x.reference}` : ''}
                  </span>
                </p>
                {x.approvalRef && (
                  <p className="mt-0.5 text-xs text-muted">Approved in: {x.approvalRef}</p>
                )}
                {x.note && (
                  <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-canvas px-3 py-2 text-xs leading-5 text-muted">
                    {x.note}
                  </p>
                )}
                {x.loggedBy && (
                  <p className="mt-1 text-[11px] text-muted">Logged by {x.loggedBy}</p>
                )}
              </div>
              <p className="amount shrink-0 font-semibold text-alert">{money(x.amount)}</p>
              <div className="flex shrink-0">
                <button
                  type="button"
                  onClick={() => startEdit(x)}
                  aria-label={`Correct the expense of ${money(x.amount)}`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-primary"
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(x)}
                  aria-label={`Delete the expense of ${money(x.amount)}`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-alert"
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
