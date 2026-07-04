import { useEffect, useRef, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { money, todayISO, METHOD_LABELS } from '../../utils/format';

const METHODS = Object.keys(METHOD_LABELS);

// The treasurer's most-used flow, optimized for speed at a meeting:
// search member → tap result → amount (auto-focused) → method chip → Log.
export default function ContributionForm({ onLogged }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [member, setMember] = useState(null);
  const [amount, setAmount] = useState('');
  const [types, setTypes] = useState([]);
  const [typeId, setTypeId] = useState('');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef(null);
  const amountRef = useRef(null);
  const searchRef = useRef(null);
  // Stable per-attempt idempotency key: only rotates after a successful
  // submit, so a retry of a failed/dropped request reuses the same key
  // instead of registering as a second contribution.
  const clientRequestIdRef = useRef(crypto.randomUUID());

  // Contribution types load once — same list is reused across entries at a meeting
  useEffect(() => {
    api
      .get('/api/types')
      .then((res) => {
        setTypes(res.data.types);
        if (res.data.types.length > 0) setTypeId((prev) => prev || res.data.types[0]._id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (member || search.trim().length < 2) {
      setResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get('/api/members', {
          params: { search: search.trim(), limit: 6 },
        });
        setResults(res.data.members);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [search, member]);

  function selectMember(m) {
    setMember(m);
    setResults([]);
    // Focus lands on the amount as soon as a member is picked
    setTimeout(() => amountRef.current?.focus(), 0);
  }

  function clearMember() {
    setMember(null);
    setSearch('');
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!member) return;
    const value = Number(String(amount).replace(/[,\s]/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      toast('Enter an amount greater than zero', 'error');
      return;
    }
    if (!typeId) {
      toast('Select a contribution type', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/contributions', {
        memberId: member._id,
        typeId,
        amount: value,
        method,
        date,
        note: note.trim(),
        clientRequestId: clientRequestIdRef.current,
      });
      toast(`Contribution logged — ${member.name}, ${money(value)}`);
      // Reset for the next entry; method and date persist for meeting-day speed
      clientRequestIdRef.current = crypto.randomUUID();
      setAmount('');
      setNote('');
      clearMember();
      onLogged?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-rule bg-surface p-4">
      {!member ? (
        <div>
          <label htmlFor="c-search" className="mb-1 block text-sm font-medium">
            Member
          </label>
          <input
            id="c-search"
            ref={searchRef}
            type="search"
            placeholder="Search name, phone or reg number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
            autoComplete="off"
          />
          {results.length > 0 && (
            <ul className="mt-2 overflow-hidden rounded-xl border border-rule">
              {results.map((m) => (
                <li key={m._id}>
                  <button
                    type="button"
                    onClick={() => selectMember(m)}
                    className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-rule px-4 text-left last:border-b-0 hover:bg-canvas"
                  >
                    <span className="min-w-0 truncate text-sm font-medium">{m.name}</span>
                    <span className="amount shrink-0 text-xs text-muted">{m.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-primary/5 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{member.name}</p>
              <p className="amount text-xs text-muted">{member.phone}</p>
            </div>
            <button
              type="button"
              onClick={clearMember}
              className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-semibold text-primary"
            >
              Change
            </button>
          </div>

          <div>
            <label htmlFor="c-amount" className="mb-1 block text-sm font-medium">
              Amount (Ksh)
            </label>
            <input
              id="c-amount"
              ref={amountRef}
              type="text"
              inputMode="numeric"
              placeholder="0"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="amount h-14 w-full rounded-xl border border-rule px-4 text-lg font-semibold"
            />
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">Contribution type</legend>
            {types.length === 0 ? (
              <p className="text-xs text-muted">
                No contribution types yet — add one from the Dashboard first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {types.map((t) => (
                  <button
                    key={t._id}
                    type="button"
                    onClick={() => setTypeId(t._id)}
                    aria-pressed={typeId === t._id}
                    className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${
                      typeId === t._id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-rule text-muted'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">Method</legend>
            <div className="grid grid-cols-4 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  aria-pressed={method === m}
                  className={`min-h-12 rounded-lg border text-xs font-semibold ${
                    method === m
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-rule text-muted'
                  }`}
                >
                  {METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="c-date" className="mb-1 block text-sm font-medium">
                Date
              </label>
              <input
                id="c-date"
                type="date"
                required
                max={todayISO()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-12 w-full rounded-xl border border-rule px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="c-note" className="mb-1 block text-sm font-medium">
                Note <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="c-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-12 w-full rounded-xl border border-rule px-3 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="h-14 w-full rounded-xl bg-primary text-base font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Logging…' : 'Log contribution'}
          </button>
        </div>
      )}
    </form>
  );
}
