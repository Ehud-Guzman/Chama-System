import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { shortDate } from '../../utils/format';

// Members who explicitly resigned — same full-openness policy as the active
// directory, kept as a separate list so a resignation isn't confused with
// simply being removed for another reason.
export default function ResignedMembersList() {
  const [members, setMembers] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef(null);

  const load = useCallback(async (searchTerm, pageNum) => {
    setLoading(true);
    try {
      const res = await api.get('/api/public/resigned', {
        params: { search: searchTerm || undefined, page: pageNum },
      });
      setMembers(res.data.members);
      setPages(res.data.pages);
      setTotal(res.data.total);
    } catch {
      // Non-fatal
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

  return (
    <div>
      <input
        type="search"
        placeholder="Search by name or reg number"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="h-12 w-full rounded-xl border border-rule bg-surface px-4 text-sm"
        aria-label="Search resigned members"
      />

      <p className="amount mt-2 text-xs text-muted">
        {total} resigned member{total === 1 ? '' : 's'}
      </p>

      {loading ? (
        <p className="mt-4 text-center text-sm text-muted">Loading…</p>
      ) : members.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-rule px-5 py-8 text-center">
          <p className="text-sm text-muted">
            {search ? 'No resigned members match that search.' : 'No one has resigned.'}
          </p>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {members.map((m, i) => (
            <li key={i} className="rounded-xl border border-rule bg-surface px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate font-semibold">{m.name}</p>
                <p className="amount shrink-0 text-xs text-muted">Resigned {shortDate(m.resignedAt)}</p>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-muted">
                <p className="amount">{m.regNumber || '—'}</p>
              </div>
              {m.resignationReason && (
                <p className="mt-1 truncate text-xs text-muted">{m.resignationReason}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-3 flex items-center justify-between" aria-label="Resigned member pages">
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
    </div>
  );
}
