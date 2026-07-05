import { useMemo, useRef, useState } from 'react';
import api from '../../services/api';
import { money, shortDate, METHOD_LABELS } from '../../utils/format';
import FinesPanel from '../shared/FinesPanel';
import WeeklyScheduleTable from '../shared/WeeklyScheduleTable';

const PAGE_SIZE = 20;

// One member's full public passbook: header, pledged-vs-contributed by type,
// the ledger, and a stamped total. Used both for a phone-number search result
// and for the directory's per-member detail view — pass a fresh `key` from the
// caller when the underlying member changes so the reveal animation replays.
// `statementUrl` (relative, e.g. /api/public/lookup/statement?phone=...) is
// optional — omit it if the caller has no way to re-identify this member.
export default function PassbookCard({ result, statementUrl }) {
  const [page, setPage] = useState(1);
  // Animates once on mount only — paging away and back doesn't replay it
  const animateRef = useRef(true);

  // Newest entries first; runningBalance was computed chronologically server-side
  const rows = useMemo(() => [...result.contributions].reverse(), [result]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const animate = animateRef.current && page === 1;

  return (
    <div className="space-y-4">
    <section className="overflow-hidden rounded-xl border border-rule bg-surface shadow-sm">
      {/* Passbook header */}
      <header className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">{result.name}</h2>
          {result.regNumber && (
            <p className="amount mt-0.5 text-xs font-medium uppercase tracking-widest text-muted">
              Member № {result.regNumber}
            </p>
          )}
        </div>
        {statementUrl && (
          <a
            href={`${api.defaults.baseURL}${statementUrl}`}
            className="shrink-0 rounded-lg border border-rule px-3 py-2 text-xs font-medium text-primary"
          >
            Export statement
          </a>
        )}
      </header>

      {/* Open book: pledged vs. contributed per type, shown whether or not
          there are contributions yet */}
      {result.byType?.length > 0 && (
        <div className="border-b border-rule px-5 py-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
            By contribution type
          </p>
          <ul className="space-y-2">
            {result.byType.map((b) => (
              <li key={b.type} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{b.type}</span>
                <span className="amount shrink-0 font-medium">
                  {money(b.contributed)}
                  {b.pledged > 0 && <span className="text-muted"> / {money(b.pledged)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">No contributions recorded yet.</p>
      ) : (
        <>
          {/* Column eyebrows */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
            <span>Date · Type</span>
            <span className="text-right">Amount</span>
            <span className="w-20 text-right">Balance</span>
          </div>

          <ul>
            {pageRows.map((c, i) => (
              <li
                key={`${page}-${i}`}
                className={`grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-t border-rule px-5 py-3 ${
                  animate ? 'ledger-row-in' : ''
                }`}
                style={animate ? { animationDelay: `${i * 40}ms` } : undefined}
              >
                <span>
                  <span className="block text-sm font-medium">{shortDate(c.date)}</span>
                  <span className="block text-xs text-muted">
                    {c.type ? `${c.type} · ` : ''}
                    {METHOD_LABELS[c.method] || c.method}
                  </span>
                  {c.fineDeducted > 0 && (
                    <span className="block text-xs text-alert">
                      − {money(c.fineDeducted)} to fines (paid {money(c.grossAmount)})
                    </span>
                  )}
                </span>
                <span className="amount text-right text-sm font-semibold">{money(c.amount)}</span>
                <span className="amount w-20 text-right text-sm font-medium text-accent">
                  {money(c.runningBalance)}
                </span>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav
              className="flex items-center justify-between border-t border-rule px-5 py-3"
              aria-label="Contribution pages"
            >
              <button
                type="button"
                onClick={() => {
                  animateRef.current = false;
                  setPage((p) => Math.max(1, p - 1));
                }}
                disabled={page === 1}
                className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary disabled:opacity-40"
              >
                Newer
              </button>
              <span className="amount text-xs text-muted">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                onClick={() => {
                  animateRef.current = false;
                  setPage((p) => Math.min(pages, p + 1));
                }}
                disabled={page === pages}
                className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary disabled:opacity-40"
              >
                Older
              </button>
            </nav>
          )}
        </>
      )}

      {/* Stamped total — shown even before a first contribution if a pledge exists */}
      <footer
        className={`border-t-2 border-primary/20 bg-primary/5 px-5 py-5 ${
          animate ? 'total-stamp' : ''
        }`}
        style={
          animate ? { animationDelay: `${Math.min(pageRows.length, 20) * 40 + 120}ms` } : undefined
        }
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Total contributed (all-time)
        </p>
        <p className="amount mt-1 text-3xl font-bold text-primary">
          {money(result.totalContributed)}
        </p>
        {result.totalPledged > 0 && (
          <p className="amount mt-1 text-sm text-muted">of {money(result.totalPledged)} pledged</p>
        )}
      </footer>
    </section>

    <FinesPanel fines={result.fines} />
    <WeeklyScheduleTable schedules={result.weeklySchedules} />
    </div>
  );
}
