import { useMemo, useState } from 'react';
import { money, shortDate } from '../../utils/format';
import { OWED_SORTS, owedSummary, searchOwed } from '../../utils/finesOwed';

// Who owes what — the fines list the office actually works from.
//
// It used to be a plain list: no search, no choice of order, and in one place a silent
// cut at ten names. That is the shape of a report you read; this is the shape of one you
// work, because the question behind "who owes what" is always the next one — *what for?*
//
// So: a line saying how many members owe, how much between them and how far back the
// oldest debt goes; a search that finds a member by name, registration number or phone
// (typed with spaces, or as +254…); the order the office needs today; every member's own
// breakdown of what he owes, on a tap; and an honest line when the list was cut short
// rather than a truncated list reading as the whole answer.
//
// Shared by Reports → Fines and the discipline screen, so the two cannot describe the
// same debts differently.
export default function WhoOwesWhat({
  members = [],
  totals,
  truncated = false,
  limit,
  emptyMessage = 'Nobody owes a fine — every one issued has been cleared.',
  note,
}) {
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState('outstanding');
  const [openId, setOpenId] = useState(null);

  const summary = useMemo(() => owedSummary(members), [members]);
  const rows = useMemo(() => searchOwed(members, term, sort), [members, term, sort]);
  // The count comes from the report when it has one, because the rows in hand may be a
  // capped list and the number a meeting is told must not depend on that.
  const owingCount = Number.isFinite(totals?.membersOwing) ? totals.membersOwing : summary.members;
  const oldest = totals?.oldestUnpaid ?? summary.oldest;
  const totalOwed = totals?.outstanding ?? summary.total;

  if (summary.members === 0) {
    return (
      <p className="rounded-xl border border-dashed border-rule px-5 py-6 text-center text-sm text-muted">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* What the list adds up to, before the list. */}
      <p className="text-sm">
        <span className="font-semibold">{owingCount}</span>{' '}
        {owingCount === 1 ? 'member owes' : 'members owe'}{' '}
        <span className="amount font-semibold text-alert">{money(totalOwed)}</span>
        {oldest ? <span className="text-muted"> · oldest since {shortDate(oldest)}</span> : null}
      </p>

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search name, phone or reg number"
          aria-label="Search members who owe fines"
          className="h-11 min-w-0 flex-1 rounded-xl border border-rule px-3 text-sm"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort members who owe fines"
          className="h-11 shrink-0 rounded-xl border border-rule px-3 text-sm"
        >
          {OWED_SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-rule px-5 py-6 text-center text-sm text-muted">
          Nobody matches “{term.trim()}”. Try part of the name, the phone number, or the reg number.
        </p>
      ) : (
        <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
          {rows.map((row) => {
            const open = openId === row.memberId;
            return (
              <li key={row.memberId}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : row.memberId)}
                  aria-expanded={open}
                  className="flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left hover:bg-canvas"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {row.name}
                      {row.active === false && (
                        <span className="ml-1 text-[11px] uppercase tracking-wide text-muted">resigned</span>
                      )}
                    </span>
                    {/* Both ways of reaching him: this line is what somebody reads out
                        before picking up the phone. */}
                    <span className="amount block text-[11px] text-muted">
                      {[row.regNumber, row.phone].filter(Boolean).join(' · ')}
                    </span>
                    <span className="amount block text-[11px] text-muted">
                      {row.fines} {row.fines === 1 ? 'fine' : 'fines'}
                      {row.oldestUnpaid ? ` · oldest ${shortDate(row.oldestUnpaid)}` : ''}
                      {row.types?.length ? ` · ${open ? 'hide' : 'what for'}` : ''}
                    </span>
                  </span>
                  <span className="amount shrink-0 text-sm font-semibold text-alert">
                    {money(row.outstanding)}
                  </span>
                </button>

                {open && row.types?.length > 0 && (
                  <ul className="space-y-1 border-t border-rule bg-canvas px-4 py-2">
                    {row.types.map((type) => (
                      <li
                        key={`${type.name}-${type.category}`}
                        className="flex items-baseline justify-between gap-3"
                      >
                        <span className="min-w-0 truncate text-xs">
                          {type.name}
                          {type.category ? (
                            <span className="ml-1 text-[11px] uppercase tracking-wide text-muted">
                              {type.category}
                            </span>
                          ) : null}
                          <span className="block text-[11px] text-muted">
                            {type.count} {type.count === 1 ? 'fine' : 'fines'}
                            {type.oldest ? ` · since ${shortDate(type.oldest)}` : ''}
                          </span>
                        </span>
                        <span className="amount shrink-0 text-xs font-medium">{money(type.outstanding)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {truncated && (
        <p className="text-[11px] text-muted">
          Showing {rows.length} of {owingCount} members owing
          {limit ? ` — the list is capped at ${limit} names` : ''}. The export lists every one.
        </p>
      )}
      {note && <p className="text-[11px] text-muted">{note}</p>}
    </div>
  );
}
