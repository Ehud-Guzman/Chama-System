import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate, METHOD_LABELS } from '../utils/format';
import Loader from '../components/shared/Loader';

const ACTION_LABELS = { create: 'Created', update: 'Edited', delete: 'Deleted' };

export default function Reports() {
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [audit, setAudit] = useState({ entries: [], page: 1, pages: 1 });
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

  async function exportCSV() {
    try {
      const res = await api.get('/api/reports/export', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'contributions.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(apiMessage(err, 'Export failed'), 'error');
    }
  }

  if (loading) return <Loader />;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Reports</p>
          <h1 className="mt-1 text-2xl font-bold">Summary</h1>
        </div>
        <button
          type="button"
          onClick={exportCSV}
          className="min-h-12 rounded-xl border border-rule bg-surface px-4 text-sm font-semibold"
        >
          Export CSV
        </button>
      </header>

      <div className="md:grid md:grid-cols-2 md:items-start md:gap-6">
      {summary && (
        <section className="rounded-xl border border-rule bg-surface p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Total contributed (all time)
          </p>
          <p className="amount mt-1 text-3xl font-bold text-primary">
            {money(summary.totalContributed)}
          </p>

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
                  {shortDate(e.createdAt)}
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
    </div>
  );
}
