import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate } from '../utils/format';
import ContributionForm from '../components/contributions/ContributionForm';
import LedgerRows from '../components/contributions/LedgerRows';
import EditContributionModal from '../components/contributions/EditContributionModal';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Loader from '../components/shared/Loader';
import { METHOD_LABELS } from '../utils/format';

export default function ContributionsLog() {
  const toast = useToast();
  const [contributions, setContributions] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [methodFilter, setMethodFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (pageNum = 1, method = '', typeId = '') => {
    setLoading(true);
    try {
      const res = await api.get('/api/contributions', {
        params: { page: pageNum, method: method || undefined, typeId: typeId || undefined },
      });
      setContributions(res.data.contributions);
      setPages(res.data.pages);
    } catch {
      // auth failures handled by interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api
      .get('/api/types', { params: { all: true } })
      .then((res) => setTypes(res.data.types))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load(page, methodFilter, typeFilter);
  }, [load, page, methodFilter, typeFilter]);

  async function saveEdit(form) {
    setBusy(true);
    try {
      await api.patch(`/api/contributions/${editing._id}`, form);
      toast('Contribution updated');
      setEditing(null);
      load(page, methodFilter, typeFilter);
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await api.delete(`/api/contributions/${deleting._id}`);
      toast('Contribution deleted');
      setDeleting(null);
      load(page, methodFilter, typeFilter);
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Log</p>
        <h1 className="mt-1 text-2xl font-bold">Log a contribution</h1>
      </header>

      <div className="md:grid md:grid-cols-[380px_1fr] md:items-start md:gap-6">
        <div className="md:sticky md:top-6">
          <ContributionForm onLogged={() => load(1, methodFilter, typeFilter)} />
        </div>

        <section className="mt-5 md:mt-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Recent</h2>
            <div className="flex gap-2">
              <select
                value={typeFilter}
                onChange={(e) => {
                  setPage(1);
                  setTypeFilter(e.target.value);
                }}
                className="min-h-11 rounded-lg border border-rule bg-surface px-2 text-sm"
                aria-label="Filter by type"
              >
                <option value="">All types</option>
                {types.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                value={methodFilter}
                onChange={(e) => {
                  setPage(1);
                  setMethodFilter(e.target.value);
                }}
                className="min-h-11 rounded-lg border border-rule bg-surface px-2 text-sm"
                aria-label="Filter by method"
              >
                <option value="">All methods</option>
                {Object.entries(METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <Loader />
          ) : (
            <LedgerRows
              contributions={contributions}
              showMember
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          )}

          {pages > 1 && (
            <nav className="mt-3 flex items-center justify-between" aria-label="Pages">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary disabled:opacity-40"
              >
                Previous
              </button>
              <span className="amount text-xs text-muted">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page === pages}
                className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary disabled:opacity-40"
              >
                Next
              </button>
            </nav>
          )}
        </section>
      </div>

      {editing && (
        <EditContributionModal
          contribution={editing}
          busy={busy}
          onSubmit={saveEdit}
          onCancel={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete this contribution?"
        body={
          deleting
            ? `${money(deleting.amount)} on ${shortDate(deleting.date)}. The record is kept in the audit trail.`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
