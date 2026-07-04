import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { money, shortDate } from '../../utils/format';

// Every active member, browsable by anyone — the group chose full openness
// over a private ledger. Phone numbers arrive already masked from the server.
export default function DirectoryList() {
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
      const res = await api.get('/api/public/directory', {
        params: { search: searchTerm || undefined, page: pageNum },
      });
      setMembers(res.data.members);
      setPages(res.data.pages);
      setTotal(res.data.total);
    } catch {
      // Non-fatal — the phone quick-check above still works
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
        aria-label="Search members"
      />

      <p className="amount mt-2 text-xs text-muted">
        {total} member{total === 1 ? '' : 's'}
      </p>

      {loading ? (
        <p className="mt-4 text-center text-sm text-muted">Loading…</p>
      ) : members.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-rule px-5 py-8 text-center">
          <p className="text-sm text-muted">
            {search ? 'No members match that search.' : 'No members registered yet.'}
          </p>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {members.map((m) => (
            <li key={m.id}>
              <Link
                to={`/member/${m.id}`}
                className="block rounded-xl border border-rule bg-surface px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate font-semibold">{m.name}</p>
                  <p className="amount shrink-0 font-semibold text-accent">
                    {money(m.totalContributed)}
                  </p>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-muted">
                  <p className="amount">
                    {m.phoneMasked}
                    {m.regNumber ? ` · ${m.regNumber}` : ''}
                  </p>
                  <p>
                    {m.lastContributionDate
                      ? `Last: ${shortDate(m.lastContributionDate)}`
                      : 'No contributions yet'}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-3 flex items-center justify-between" aria-label="Member pages">
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
