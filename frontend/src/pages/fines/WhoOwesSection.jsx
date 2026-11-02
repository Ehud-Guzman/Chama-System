import { FILTERS, FineRow } from './shared';

export default function WhoOwesSection({ changeFilter, changePage, list, page, search, setPaying, setSearch, setUndoing, setVoiding, status }) {
  return (
    <section className="overflow-hidden rounded-xl border border-rule bg-surface">
      <div className="space-y-3 border-b border-rule px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            {list?.scopeLabel || 'Fines'}
            {list ? ` (${list.total})` : ''}
          </h2>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => changeFilter(f.value)}
                aria-pressed={status === f.value}
                className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${
                  status === f.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-rule text-muted'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a member by name, phone or reg number"
          aria-label="Search fines by member"
          className="h-11 w-full rounded-xl border border-rule bg-canvas px-4 text-sm"
        />
      </div>

      {!list ? (
        <p className="px-5 py-8 text-center text-sm text-muted">Loading…</p>
      ) : list.fines.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          {search.trim()
            ? `No fine matches “${search.trim()}”.`
            : status === 'pending'
              ? 'Nothing is owed. Every fine issued has been cleared.'
              : status === 'voided'
                ? 'No fine has been voided.'
                : 'No fines on this list.'}
        </p>
      ) : (
        <ul>
          {list.fines.map((f) => (
            <FineRow
              key={f.id}
              fine={f}
              onPay={() => setPaying({ memberId: f.memberId, fineId: f.id })}
              onVoid={() => setVoiding(f)}
              onUndo={(payment) => setUndoing({ fine: f, payment })}
            />
          ))}
        </ul>
      )}

      {list && list.pages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-rule px-4 py-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => changePage(page - 1)}
            className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium disabled:opacity-50"
          >
            Previous
          </button>
          <p className="text-xs text-muted">
            Page {page} of {list.pages}
          </p>
          <button
            type="button"
            disabled={page >= list.pages}
            onClick={() => changePage(page + 1)}
            className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
