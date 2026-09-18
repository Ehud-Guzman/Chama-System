import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useModal } from '../../hooks/useModal';
import { money, shortDate } from '../../utils/format';
import ContributionChart from './ContributionChart';

// One compact figure tile. The shared StatTile is sized for a dashboard headline;
// four of them inside a phone-width sheet would wrap every money figure, so this
// is the same idea at sheet scale.
function Tile({ label, value, hint, accent }) {
  return (
    <div className="min-w-0 rounded-xl border border-rule px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className={`amount mt-0.5 truncate text-lg font-bold ${accent ? 'text-primary' : ''}`}>
        {value}
      </p>
      {hint && <p className="amount mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function consistencyClass(pct) {
  if (pct === null || pct === undefined) return 'text-muted';
  if (pct >= 80) return 'text-accent';
  if (pct >= 50) return 'text-primary';
  return 'text-alert';
}

// One member's contribution chart, opened from his row in the performance report.
//
// Fetched when the sheet opens rather than carried in from the table: the table
// holds one figure for every member, and what this screen needs is twelve months
// for one of them. A bottom sheet on a phone, a centred dialog on anything wider —
// the same shape every other panel in this app uses.
export default function MemberChartModal({ member, onClose }) {
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const containerRef = useModal(true, onClose);

  useEffect(() => {
    let cancelled = false;

    api
      .get(`/api/reports/member/${member.memberId}`)
      .then((res) => {
        if (cancelled) return;
        setReport(res.data);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(apiMessage(err, 'Could not load this member’s chart'));
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [member.memberId]);

  const totals = report?.totals;
  const weekly = report?.weekly;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:px-4 sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${member.name} — contributions`}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className="max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-surface shadow-xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-rule bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{member.name}</p>
            <p className="amount truncate text-xs text-muted">
              {member.regNumber ? `${member.regNumber} · ` : ''}
              {member.phone}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 rounded-lg border border-rule px-3 text-sm font-medium"
          >
            Close
          </button>
        </header>

        <div className="px-4 py-4">
          {status === 'loading' && (
            <p className="py-8 text-center text-sm text-muted">Loading the chart…</p>
          )}

          {status === 'error' && (
            <p className="py-8 text-center text-sm font-medium text-alert" role="alert">
              {error}
            </p>
          )}

          {status === 'ready' && report && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile
                  label="Member's own"
                  value={money(totals.personal)}
                  accent
                  hint={
                    totals.carriedIn > 0 ? `+ ${money(totals.carriedIn)} carried in` : undefined
                  }
                />
                <Tile label="Group funds (tea)" value={money(totals.groupFund)} />
                <Tile
                  label="Weeks paid"
                  value={`${weekly.weeksPaid}/${weekly.weeksExpected}`}
                  hint={weekly.weeksPartial > 0 ? `+${weekly.weeksPartial} partial` : undefined}
                />
                <Tile
                  label="Consistency"
                  value={weekly.consistency === null ? '—' : `${weekly.consistency}%`}
                  hint={
                    totals.contributionCount ? `${totals.contributionCount} rows logged` : undefined
                  }
                />
              </div>

              <section className="mt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
                    Last 12 months
                  </h3>
                  <p className="amount text-xs text-muted">
                    Last paid {shortDate(totals.lastContributionDate)}
                  </p>
                </div>

                <div className="mt-2 rounded-xl border border-rule px-3 py-3">
                  <ContributionChart
                    points={report.months}
                    emptyMessage="Nothing was logged against this member in the last 12 months."
                  />
                </div>

                <p className="mt-2 text-[11px] leading-5 text-muted">
                  The dark bars are money the member himself put in. Group funds — the Tea
                  Fund collected from everyone each week — are shown separately so his effort
                  isn&rsquo;t overstated.
                </p>
              </section>

              <section className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Month by month
                </h3>

                <ul className="mt-2 divide-y divide-rule border-t border-rule">
                  {[...report.months].reverse().map((month) => (
                    <li key={month.month} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="amount text-sm">{month.label}</span>
                      <span className="amount min-w-0 text-right text-sm font-semibold text-primary">
                        {money(month.personal)}
                        {month.groupFund > 0 && (
                          <span className="ml-1 text-xs font-normal text-muted">
                            + {money(month.groupFund)} tea
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {report.byType.length > 0 && (
                <section className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
                    By contribution type
                  </h3>

                  <ul className="mt-2 divide-y divide-rule border-t border-rule">
                    {report.byType.map((type) => (
                      <li key={type.name} className="flex items-baseline justify-between gap-3 py-2">
                        <span className="min-w-0 truncate text-sm">
                          {type.name}
                          {type.isGroupFund && (
                            <span className="ml-1 text-[10px] uppercase tracking-wide text-muted">
                              group fund
                            </span>
                          )}
                        </span>
                        <span className="amount shrink-0 text-sm font-semibold">
                          {money(type.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <p
                className={`amount mt-3 text-xs font-semibold ${consistencyClass(weekly.consistency)}`}
              >
                Consistency = weeks paid in full ÷ weeks expected since the cycle opened.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
