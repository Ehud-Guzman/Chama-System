import { useCallback, useEffect, useRef, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import MemberCards from '../components/members/MemberCards';
import MemberForm from '../components/members/MemberForm';
import CSVImportModal from '../components/members/CSVImportModal';
import Loader from '../components/shared/Loader';

export default function MembersList() {
  const toast = useToast();
  const [members, setMembers] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  const load = useCallback(async (searchTerm, pageNum) => {
    setLoading(true);
    try {
      const res = await api.get('/api/members', {
        params: { search: searchTerm || undefined, page: pageNum, status: 'all' },
      });
      setMembers(res.data.members);
      setPages(res.data.pages);
      setTotal(res.data.total);
    } catch {
      // interceptor handles auth failures; other errors leave the list as-is
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load('', 1);
  }, [load]);

  function onSearchChange(value) {
    setSearch(value);
    setPage(1);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(value, 1), 300);
  }

  function goToPage(p) {
    setPage(p);
    load(search, p);
  }

  async function createMember(form) {
    setSaving(true);
    try {
      await api.post('/api/members', form);
      toast('Member added');
      setShowForm(false);
      load(search, page);
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function exportExcel() {
    try {
      const res = await api.get('/api/members/export', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'members.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(apiMessage(err, 'Export failed'), 'error');
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Members</p>
          <h1 className="mt-1 text-2xl font-bold">
            {total} member{total === 1 ? '' : 's'}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="min-h-12 rounded-xl bg-primary px-4 text-sm font-semibold text-white"
        >
          Add member
        </button>
      </header>

      <input
        type="search"
        placeholder="Search name, phone or reg number"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="h-12 w-full rounded-xl border border-rule bg-surface px-4 text-sm"
        aria-label="Search members"
      />

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="min-h-11 flex-1 rounded-lg border border-rule bg-surface text-sm font-medium"
        >
          Import CSV
        </button>
        <button
          type="button"
          onClick={exportExcel}
          className="min-h-11 flex-1 rounded-lg border border-rule bg-surface text-sm font-medium"
        >
          Export Excel
        </button>
      </div>

      {loading ? (
        <Loader />
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-rule px-5 py-10 text-center">
          <p className="text-sm text-muted">
            {search ? 'No members match that search.' : 'No members yet. Add the first one.'}
          </p>
        </div>
      ) : (
        <MemberCards members={members} />
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Member pages">
          <button
            type="button"
            onClick={() => goToPage(Math.max(1, page - 1))}
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
            onClick={() => goToPage(Math.min(pages, page + 1))}
            disabled={page === pages}
            className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}

      {showForm && (
        <MemberForm busy={saving} onSubmit={createMember} onCancel={() => setShowForm(false)} />
      )}
      {showImport && (
        <CSVImportModal
          onClose={() => setShowImport(false)}
          onImported={() => load(search, page)}
        />
      )}
    </div>
  );
}
