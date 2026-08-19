import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate, shortDateTime, METHOD_LABELS } from '../utils/format';
import { whatsappLink } from '../utils/messaging';
import Loader from '../components/shared/Loader';

const ACTION_LABELS = { create: 'Created', update: 'Edited', delete: 'Deleted' };

async function downloadFile(url, filename, toast) {
  try {
    const res = await api.get(url, { responseType: 'blob' });
    const objectUrl = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    toast(apiMessage(err, 'Export failed'), 'error');
  }
}

function consistencyClass(pct) {
  if (pct === null || pct === undefined) return 'text-muted';
  if (pct >= 80) return 'text-accent';
  if (pct >= 50) return 'text-primary';
  return 'text-alert';
}

export default function Reports() {
  const toast = useToast();
  const [tab, setTab] = useState('summary'); // summary | performance | monthly | weekly
  const [summary, setSummary] = useState(null);
  const [audit, setAudit] = useState({ entries: [], page: 1, pages: 1 });
  const [performance, setPerformance] = useState(null);
  const [months, setMonths] = useState(null);
  const [weeks, setWeeks] = useState(null);
  const [openWeek, setOpenWeek] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAudit = useCallback(async (page = 1) => {
    try {
      const res = await api.get('/api/reports/audit-log', { params: { page } });
      setAudit(res.data);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    Promise.all([api.get('/api/reports/summary'), loadAudit(1)])
      .then(([s]) => setSummary(s.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loadAudit]);

  useEffect(() => {
    if (tab === 'performance' && !performance) {
      api
        .get('/api/reports/performance')
        .then((res) => setPerformance(res.data.members))
        .catch(() => {});
    }
    if (tab === 'monthly' && !months) {
      api
        .get('/api/reports/monthly')
        .then((res) => setMonths(res.data.months))
        .catch(() => {});
    }
    if (tab === 'weekly' && !weeks) {
      api
        .get('/api/reports/weekly')
        .then((res) => setWeeks(res.data.weeks))
        .catch(() => {});
    }
  }, [tab, performance, months, weeks]);

  if (loading) return <Loader />;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Reports</p>
          <h1 className="mt-1 text-2xl font-bold">
            {tab === 'summary'
              ? 'Summary'
              : tab === 'performance'
              ? 'Member performance'
              : tab === 'monthly'
              ? 'Monthly totals'
              : 'Weekly reconciliation'}
          </h1>
        </div>
        <div className="flex gap-2">
          {tab === 'summary' && (
            <button
              type="button"
              onClick={() => downloadFile('/api/reports/export', 'contributions.xlsx', toast)}
              className="min-h-12 rounded-xl border border-rule bg-surface px-4 text-sm font-semibold"
            >
              Export Excel
            </button>
          )}
          {tab === 'performance' && (
            <button
              type="button"
              onClick={() => downloadFile('/api/reports/performance/export', 'member-performance.xlsx', toast)}
              className="min-h-12 rounded-xl border border-rule bg-surface px-4 text-sm font-semibold"
            >
              Export Excel
            </button>
          )}
          {tab === 'monthly' && (
            <button
              type="button"
              onClick={() => downloadFile('/api/reports/monthly/export', 'monthly-totals.xlsx', toast)}
              className="min-h-12 rounded-xl border border-rule bg-surface px-4 text-sm font-semibold"
            >
              Export Excel
            </button>
          )}
          {tab === 'weekly' && (
            <button
              type="button"
              onClick={() => downloadFile('/api/reports/weekly/export', 'weekly-reconciliation.xlsx', toast)}
              className="min-h-12 rounded-xl border border-rule bg-surface px-4 text-sm font-semibold"
            >
              Export Excel
            </button>
          )}
        </div>
      </header>

      <div className="flex gap-2">
        {[
          ['summary', 'Summary'],
          ['weekly', 'Weekly reconciliation'],
          ['performance', 'Member performance'],
          ['monthly', 'Monthly totals'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${
              tab === value ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
      <div className="md:grid md:grid-cols-2 md:items-start md:gap-6">
      {summary && (
        <section className="rounded-xl border border-rule bg-surface p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Total contributed (all time)
          </p>
          <p className="amount mt-1 text-3xl font-bold text-primary">
            {money(summary.totalContributed)}
          </p>
          <p className="amount mt-1 text-sm text-muted">{money(summary.thisWeekTotal)} this week</p>

          {summary.totalExpenses > 0 && (
            <p className="amount mt-1 text-sm text-alert">
              − {money(summary.totalExpenses)} spent from tracked funds
            </p>
          )}
          <p className="amount mt-1 text-lg font-semibold">
            {money(summary.netBalance)} <span className="text-xs font-normal text-muted">net balance</span>
          </p>

          {summary.finesCollected > 0 && (
            <p className="amount mt-1 text-xs text-muted">
              + {money(summary.finesCollected)} collected from fines (not counted above — fines
              aren't a contribution type)
            </p>
          )}

          <p className="mt-4 border-t border-rule pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
            By method
          </p>
          <ul>
            {summary.byMethod.map((m) => (
              <li
                key={m.method}
                className="flex items-baseline justify-between border-b border-rule py-2 last:border-b-0"
              >
                <span className="text-sm">
                  {METHOD_LABELS[m.method] || m.method}
                  <span className="amount ml-2 text-xs text-muted">×{m.count}</span>
                </span>
                <span className="amount text-sm font-semibold">{money(m.total)}</span>
              </li>
            ))}
          </ul>

          {summary.byType?.length > 0 && (
            <>
              <p className="mt-4 border-t border-rule pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
                By type
              </p>
              <ul>
                {summary.byType.map((t) => (
                  <li
                    key={t.typeId}
                    className="flex items-baseline justify-between border-b border-rule py-2 last:border-b-0"
                  >
                    <span className="text-sm">
                      {t.name}
                      <span className="amount ml-2 text-xs text-muted">×{t.count}</span>
                    </span>
                    <span className="amount text-sm font-semibold">{money(t.total)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-3 text-sm text-muted">
            <span className="amount font-semibold text-ink">
              {summary.membersWithZeroContributions}
            </span>{' '}
            of {summary.activeMembers} active members are yet to contribute.
          </p>
        </section>
      )}

      <section className="mt-5 md:mt-0">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
          Audit trail
        </h2>
        {audit.entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
            No activity recorded yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
            {audit.entries.map((e) => (
              <li key={e._id} className="border-b border-rule px-4 py-3 last:border-b-0">
                <p className="text-sm">
                  <span className="font-semibold">{e.performedBy?.name || 'Unknown'}</span>{' '}
                  <span className="text-muted">
                    {(ACTION_LABELS[e.action] || e.action).toLowerCase()} a{' '}
                    {e.entityType.toLowerCase()}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {shortDateTime(e.createdAt)}
                  {e.entityType === 'Contribution' && (e.after || e.before) && (
                    <span className="amount">
                      {' '}
                      · {money((e.after || e.before).amount)}
                    </span>
                  )}
                  {e.entityType === 'Member' && (e.after || e.before) && (
                    <span> · {(e.after || e.before).name}</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}

        {audit.pages > 1 && (
          <nav className="mt-3 flex items-center justify-between" aria-label="Audit pages">
            <button
              type="button"
              onClick={() => loadAudit(Math.max(1, audit.page - 1))}
              disabled={audit.page === 1}
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary disabled:opacity-40"
            >
              Previous
            </button>
            <span className="amount text-xs text-muted">
              Page {audit.page} of {audit.pages}
            </span>
            <button
              type="button"
              onClick={() => loadAudit(Math.min(audit.pages, audit.page + 1))}
              disabled={audit.page === audit.pages}
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary disabled:opacity-40"
            >
              Next
            </button>
          </nav>
        )}
      </section>
      </div>
      )}

      {tab === 'performance' && (
        <section>
          {!performance ? (
            <Loader />
          ) : performance.length === 0 ? (
            <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
              No active members yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-rule bg-surface">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-[10px] font-semibold uppercase tracking-widest text-muted">
                    <th className="px-3 py-2">Member</th>
                    <th className="px-3 py-2 text-right">Total (all-time)</th>
                    <th className="px-3 py-2 text-right">Weeks paid</th>
                    <th className="px-3 py-2 text-right">Consistency</th>
                    <th className="px-3 py-2 text-right">Fines owed</th>
                    <th className="px-3 py-2 text-right">Last contribution</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {performance.map((m) => (
                    <tr key={m.memberId} className="border-b border-rule last:border-b-0">
                      <td className="px-3 py-2">
                        <p className="truncate font-medium">{m.name}</p>
                        {m.regNumber && <p className="amount text-xs text-muted">{m.regNumber}</p>}
                      </td>
                      <td className="amount px-3 py-2 text-right font-semibold">
                        {money(m.totalContributed)}
                      </td>
                      <td className="amount px-3 py-2 text-right text-muted">
                        {m.weeksPaid}/{m.weeksExpected}
                        {m.weeksPartial > 0 ? ` (+${m.weeksPartial} partial)` : ''}
                      </td>
                      <td className={`amount px-3 py-2 text-right font-semibold ${consistencyClass(m.consistency)}`}>
                        {m.consistency === null ? '—' : `${m.consistency}%`}
                      </td>
                      <td className="amount px-3 py-2 text-right">
                        {m.pendingFines > 0 ? (
                          <span className="text-alert">{money(m.pendingFines)}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="amount px-3 py-2 text-right text-xs text-muted">
                        {shortDate(m.lastContributionDate)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {(m.consistency !== null && m.consistency < 80) || m.pendingFines > 0 ? (
                          <a
                            href={whatsappLink(
                              m.phone,
                              `Hi ${m.name.split(' ')[0]}, this is a reminder from the chama.${
                                m.pendingFines > 0 ? ` You have ${money(m.pendingFines)} in unpaid fines.` : ''
                              }`
                            )}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-medium text-primary"
                          >
                            Remind
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            Consistency = weeks paid in full ÷ weeks expected since joining, personal weekly
            contribution types only (group funds like Chai aren't counted as individual effort).
          </p>
        </section>
      )}

      {tab === 'monthly' && (
        <section>
          {!months ? (
            <Loader />
          ) : months.length === 0 ? (
            <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
              No contributions logged yet.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
              {months.map((m) => (
                <li key={m.month} className="border-b border-rule px-4 py-3 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="amount text-sm font-semibold">{m.month}</p>
                    <p className="amount text-sm font-semibold text-primary">{money(m.total)}</p>
                  </div>
                  <p className="amount mt-0.5 text-xs text-muted">
                    {money(m.personalTotal)} personal · {money(m.groupFundTotal)} group funds
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-medium text-primary">
                      By type
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {m.byType.map((t) => (
                        <li key={t.name} className="flex justify-between text-xs text-muted">
                          <span>{t.name}</span>
                          <span className="amount">{money(t.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'weekly' && (
        <section>
          {!weeks ? (
            <Loader />
          ) : weeks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
              No weekly contribution types set up yet.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted">
                Expected vs actual, per week, across every fixed weekly contribution type. The
                totals rarely match exactly on their own — one member overpaying offsets another
                falling short — so a week is only flagged{' '}
                <span className="font-semibold text-alert">short</span> when one or more eligible
                members still owe their weekly minimum. Tap a week to see exactly who.
              </p>
              <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
                {weeks.map((w) => (
                  <li key={w.weekNumber} className="border-b border-rule last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setOpenWeek(openWeek === w.weekNumber ? null : w.weekNumber)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <span className="flex items-center gap-2">
                        <span className="amount text-sm font-semibold">Week {w.weekNumber}</span>
                        {w.isCurrent && (
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                            Now
                          </span>
                        )}
                        <span className="amount text-xs text-muted">
                          {shortDate(w.startDate)} – {shortDate(w.endDate)}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span
                          className={`text-xs font-semibold ${w.balanced ? 'text-accent' : 'text-alert'}`}
                        >
                          {w.balanced ? 'All paid' : `${w.shortfallCount} short`}
                        </span>
                        <span className="amount text-sm font-semibold">{money(w.actualTotal)}</span>
                        <span className="amount text-xs text-muted">/ {money(w.expectedTotal)}</span>
                      </span>
                    </button>

                    {openWeek === w.weekNumber && (
                      <div className="border-t border-rule bg-canvas/40 px-4 py-3">
                        <div className="space-y-3">
                          {w.types.map((t) => (
                            <div key={t.typeId}>
                              <div className="flex items-baseline justify-between gap-3">
                                <p className="text-sm font-semibold">
                                  {t.typeName}
                                  {t.isGroupFund && (
                                    <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-muted">
                                      group fund
                                    </span>
                                  )}
                                </p>
                                <p
                                  className={`amount text-sm font-semibold ${
                                    t.diff === 0 ? 'text-accent' : 'text-alert'
                                  }`}
                                >
                                  {money(t.actual)} / {money(t.expected)}
                                  {t.diff !== 0 && (
                                    <span className="ml-1 text-xs">
                                      ({t.diff > 0 ? '+' : ''}
                                      {money(t.diff)})
                                    </span>
                                  )}
                                </p>
                              </div>
                              {t.untrackedAmount > 0 && (
                                <p className="amount mt-0.5 text-xs text-muted">
                                  + {money(t.untrackedAmount)} logged against ineligible/system
                                  members (e.g. backdated opening balances)
                                </p>
                              )}
                              {t.shortfallMembers.length > 0 ? (
                                <ul className="mt-1 space-y-0.5">
                                  {t.shortfallMembers.map((m) => (
                                    <li
                                      key={m.memberId}
                                      className="flex items-center justify-between text-xs"
                                    >
                                      <span className="text-muted">
                                        {m.name}
                                        {m.regNumber && (
                                          <span className="amount ml-1 text-muted">
                                            ({m.regNumber})
                                          </span>
                                        )}
                                      </span>
                                      <span
                                        className={`amount font-medium ${
                                          m.status === 'unpaid' ? 'text-alert' : 'text-primary'
                                        }`}
                                      >
                                        {money(m.paid)} · {m.status}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-1 text-xs text-muted">
                                  Every eligible member paid in full this week.
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
