import { useCallback, useEffect, useRef, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import MemberCards from '../components/members/MemberCards';
import MemberForm from '../components/members/MemberForm';
import CSVImportModal from '../components/members/CSVImportModal';
import Loader from '../components/shared/Loader';
import { takeWarmJson, clearWarmJson } from '../services/prefetch';

// The request this page makes, in one place: the prefetch that fills it on hover
// and the fetch that reads it at mount have to agree on the shape exactly, or the
// warmed copy is simply never used.
function listParams(searchTerm, pageNum) {
  return { search: searchTerm || undefined, page: pageNum, status: 'all' };
}

export default function MembersList() {
  const toast = useToast();
  const [members, setMembers] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [missingIds, setMissingIds] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  const apply = useCallback((payload) => {
    setMembers(payload.members);
    setPages(payload.pages);
    setTotal(payload.total);
    // How many active members the server says still have no usable ID: the one
    // figure that tells the office what to chase, since the members' page is
    // opened with that number now.
    setMissingIds(payload.withoutNationalId || 0);
  }, []);

  const load = useCallback(
    async (searchTerm, pageNum) => {
      const params = listParams(searchTerm, pageNum);
      // A response warmed while the pointer was on the Members link: paint it
      // immediately and let the request below confirm it, so the page shows names
      // instead of a spinner for a round trip that has already been paid for.
      const warmed = takeWarmJson('/api/members', params);
      if (warmed) apply(warmed);
      setLoading(!warmed);
      try {
        const res = await api.get('/api/members', { params });
        apply(res.data);
      } catch {
        // interceptor handles auth failures; other errors leave the list as-is
      } finally {
        setLoading(false);
      }
    },
    [apply]
  );

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
      // The warmed copy was fetched before this member existed: drop it so the
      // reload below is the server's answer, not the list from a second ago.
      clearWarmJson();
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
        <div className="flex items-center justify-between">
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
        </div>
      </header>

      <input
        type="search"
        placeholder="Search name, phone, ID or reg no."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="h-12 w-full rounded-xl border border-rule bg-surface px-4 text-sm"
        aria-label="Search members"
      />

      {/* The ID is the key to a member's own record, so a member without one
          cannot open anything on the public page. The office is the only party
          who can fix that, and this line is where they find out. */}
      {missingIds > 0 && (
        <p className="rounded-xl border border-rule bg-page px-4 py-3 text-sm leading-5 text-muted">
          <span className="font-semibold text-ink">
            {missingIds} member{missingIds === 1 ? '' : 's'}
          </span>{' '}
          {missingIds === 1 ? 'has' : 'have'} no ID recorded, so{' '}
          {missingIds === 1 ? 'he cannot' : 'they cannot'} open a record on the members&rsquo;
          page yet. Open the member and add the ID number.
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="min-h-11 flex-1 rounded-lg border border-rule bg-surface text-sm font-medium"
        >
          Import
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
          onImported={() => {
            clearWarmJson();
            load(search, page);
          }}
        />
      )}
    </div>
  );
}
