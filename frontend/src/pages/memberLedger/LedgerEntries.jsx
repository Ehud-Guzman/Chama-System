import { useState } from 'react';
import { shortDate, METHOD_LABELS, money } from '../../utils/format';
import { TrashIcon } from '../../components/shared/icons';
import { Link } from 'react-router-dom';

// The weeks of the live cycle show newest first, and only this many until the reader asks for the rest: the list
// grows by a row every Friday, and a screen of rows nobody is looking for buries the one running now.
const WEEKS_PREVIEW = 8;

export default function LedgerEntries({ data, expenses, ledger, logs, member, setDeleting, setShowWeeks, showWeeks, teaFund, week }) {
  const [showAllWeeks, setShowAllWeeks] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const weeksNewestFirst = [...ledger.weeks].reverse();
  const weeksShown = showAllWeeks ? weeksNewestFirst : weeksNewestFirst.slice(0, WEEKS_PREVIEW);
  return (
    <div className="min-w-0 space-y-5">
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
            His entries ({logs.length})
          </h2>
          <button
            type="button"
            onClick={() => setShowWeeks((v) => !v)}
            className="-mr-2 -my-1 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-primary"
          >
            {showWeeks ? 'Hide weeks' : 'Week by week'}
          </button>
        </div>

        {logs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
            Nothing logged for {member.name} since week {week.currentWeek} yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
            {logs.map((l) => (
              <li key={l._id} className="flex items-start gap-3 border-b border-rule px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {shortDate(l.date)}
                    <span className="text-muted">
                      {' · '}W{l.week} · {l.typeName || 'Contribution'} ·{' '}
                      {METHOD_LABELS[l.method] || l.method}
                    </span>
                  </p>
                  {l.note && (
                    <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-canvas px-3 py-2 text-xs leading-5 text-muted">
                      {l.note}
                    </p>
                  )}
                </div>
                <p className="amount shrink-0 font-semibold">{money(l.amount)}</p>
                <button
                  type="button"
                  onClick={() => setDeleting({ ...l, kind: 'contribution' })}
                  aria-label={`Delete ${money(l.amount)} on ${shortDate(l.date)}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-alert"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showWeeks && (
        <section className="overflow-x-auto rounded-xl border border-rule bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-rule bg-canvas">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">Week</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">Paid in</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">Tea (auto)</th>
              </tr>
            </thead>
            <tbody>
              {weeksShown.map((w) => (
                <tr key={w.weekNumber} className="border-b border-rule last:border-b-0">
                  <td className="amount px-3 py-2">
                    {w.weekNumber}
                    {w.isCurrent && (
                      <span className="ml-1 text-[11px] uppercase tracking-wide text-primary">now</span>
                    )}
                  </td>
                  <td className="amount px-3 py-2">{money(w.personalPaid)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest ${
                        w.status === 'paid'
                          ? 'bg-primary/10 text-primary'
                          : w.status === 'partial'
                            ? 'bg-accent/10 text-accent'
                            : w.nillFineDue
                              ? 'bg-alert/10 text-alert'
                              : 'bg-canvas text-muted'
                      }`}
                    >
                      {w.isBaseline
                        ? 'opening'
                        : w.status === 'paid'
                          ? 'paid in full'
                          : w.status === 'partial'
                            ? 'partly paid'
                            : 'nothing paid'}
                    </span>
                  </td>
                  <td className="amount px-3 py-2 text-muted">
                    {money(w.chaiAmount ?? ledger.chaiAmount)}
                  </td>
                </tr>
              ))}

              {weeksNewestFirst.length > WEEKS_PREVIEW && (
                <tr className="border-b border-rule">
                  <td colSpan={4} className="p-0">
                    <button
                      type="button"
                      onClick={() => setShowAllWeeks((v) => !v)}
                      className="min-h-11 w-full text-sm font-semibold text-primary"
                    >
                      {showAllWeeks
                        ? `Show the last ${WEEKS_PREVIEW} weeks`
                        : `Show all ${weeksNewestFirst.length} weeks of this cycle`}
                    </button>
                  </td>
                </tr>
              )}

              {data.history?.length > 0 && (() => {
                // A week before the cycle that was collected — the one-time week-91 entry — shows its
                // money and its tea, and always stays on show. Every other week before the cycle is
                // carried forward inside the opening balance: ninety-odd rows saying so bury the week
                // that is running, so they sit behind one line and a toggle.
                const newestFirst = [...data.history].reverse();
                const wasCollected = (w) => w.paid > 0 || w.chaiPaid > 0;
                const rows = showHistory ? newestFirst : newestFirst.filter(wasCollected);
                const folded = newestFirst.length - rows.length;
                return (
                  <>
                    <tr className="border-b border-rule bg-canvas">
                      <td colSpan={4} className="px-3 py-2 text-xs leading-5 text-muted">
                        Weeks 1–{data.history[data.history.length - 1].weekNumber} ran before this ledger
                        opened. Their money is already inside the {money(ledger.openingBalance)} brought
                        forward, so they are never scored again.
                        {(folded > 0 || showHistory) && (
                          <>
                            {' '}
                            <button
                              type="button"
                              onClick={() => setShowHistory((v) => !v)}
                              className="font-semibold text-primary"
                            >
                              {showHistory ? 'Hide them' : `Show the other ${folded} weeks`}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {rows.map((w) => {
                      const collected = wasCollected(w);
                      return (
                        <tr key={w.weekNumber} className="border-b border-rule text-muted last:border-b-0">
                          <td className="amount px-3 py-2">{w.weekNumber}</td>
                          <td className="amount px-3 py-2">{collected ? money(w.paid || 0) : '—'}</td>
                          <td className="px-3 py-2">
                            {collected ? (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-primary">
                                paid in
                              </span>
                            ) : (
                              <span className="text-xs">counted in his carried-in money</span>
                            )}
                          </td>
                          <td className="amount px-3 py-2">
                            {collected && w.chaiPaid > 0 ? money(w.chaiPaid) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                );
              })()}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
            Fund spending{teaFund ? ` — Tea Fund holds ${money(teaFund.balance)}` : ''}
          </h2>
          {/* The group's whole spending record, where an expense is a row of its own
              rather than something attached to this member. */}
          <Link
            to="/admin/finance/expenses"
            className="-mr-2 -my-1 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-primary"
          >
            All spending
          </Link>
        </div>
        {expenses.length === 0 ? (
          <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
            Nothing spent from the funds yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
            {expenses.map((x) => (
              <li key={x._id} className="flex items-start gap-3 border-b border-rule px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {x.description || 'Expense'}
                    <span className="text-muted">
                      {' · '}
                      {x.typeId?.name ? `${x.typeId.name} · ` : ''}
                      {shortDate(x.date)}
                    </span>
                  </p>
                  {x.note && (
                    <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-canvas px-3 py-2 text-xs leading-5 text-muted">
                      {x.note}
                    </p>
                  )}
                </div>
                <p className="amount shrink-0 font-semibold text-alert">{money(x.amount)}</p>
                <button
                  type="button"
                  onClick={() => setDeleting({ ...x, kind: 'expense' })}
                  aria-label={`Delete expense of ${money(x.amount)}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-alert"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
