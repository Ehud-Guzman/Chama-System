import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { inputClass } from './controlUi';

// Find one member by name, registration number, phone or ID, and pick him.
//
// Searches the whole register (active and not), because the second record of a duplicate is often
// the one that was already switched off. Debounced, and a late answer to an old search is thrown
// away so the list never shows results for something the box no longer says.
export default function MemberPicker({ id, label, value, onPick, exclude }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      return undefined;
    }
    const ticket = ++latest.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/api/members', { params: { search: text, status: 'all', limit: 8 } });
        if (ticket === latest.current) setResults(res.data.members || []);
      } catch {
        if (ticket === latest.current) setResults([]);
      } finally {
        if (ticket === latest.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  if (value) {
    return (
      <div>
        <span className="mb-1 block text-xs font-medium">{label}</span>
        <div className="flex items-center gap-3 rounded-lg border border-rule bg-canvas px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{value.name}</p>
            <p className="truncate text-xs text-muted">
              {[value.regNumber, value.phone, value.active === false ? 'inactive' : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onPick(null);
              setQuery('');
            }}
            className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-semibold text-primary"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  const shown = results.filter((member) => !exclude || String(member._id) !== String(exclude));

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Name, number, phone or ID"
        autoComplete="off"
        className={inputClass}
      />
      {query.trim().length >= 2 && (
        <ul className="mt-1 max-h-60 divide-y divide-rule overflow-y-auto rounded-lg border border-rule bg-surface">
          {searching && shown.length === 0 && <li className="px-3 py-2 text-xs text-muted">Searching…</li>}
          {!searching && shown.length === 0 && <li className="px-3 py-2 text-xs text-muted">Nobody found.</li>}
          {shown.map((member) => (
            <li key={member._id}>
              <button
                type="button"
                onClick={() => onPick(member)}
                className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-elevation"
              >
                <span className="text-sm font-medium">{member.name}</span>
                <span className="text-xs text-muted">
                  {[member.regNumber, member.phone, member.active === false ? 'inactive' : null].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
