import { useEffect, useMemo, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { todayISO } from '../utils/format';
import Loader from '../components/shared/Loader';

// Disciplinary officer's one screen: pick a member, pick an infraction type,
// pick a date, done. Amount is prefilled from the type's default penalty but
// stays editable, and no access to financial fines/contributions.
export default function DisciplinaryFines() {
  const toast = useToast();
  const [members, setMembers] = useState([]);
  const [types, setTypes] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [typeId, setTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/api/members', { params: { status: 'active', limit: 500 } }),
      api.get('/api/fine-types', { params: { category: 'disciplinary' } }),
    ])
      .then(([membersRes, typesRes]) => {
        setMembers(membersRes.data.members);
        setTypes(typesRes.data.types);
        if (typesRes.data.types.length > 0) {
          setTypeId(typesRes.data.types[0]._id);
          setAmount(typesRes.data.types[0].defaultAmount > 0 ? String(typesRes.data.types[0].defaultAmount) : '');
        }
      })
      .catch((err) => toast(apiMessage(err, 'Could not load members/fine types'), 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => m.name.toLowerCase().includes(q) || m.phone.includes(q) || m.regNumber?.toLowerCase().includes(q)
    );
  }, [members, search]);

  function openFor(member) {
    setOpenId(openId === member._id ? null : member._id);
    setDate(todayISO());
  }

  function selectType(type) {
    setTypeId(type._id);
    setAmount(type.defaultAmount > 0 ? String(type.defaultAmount) : '');
  }

  async function issue(member) {
    if (!typeId) {
      toast('Select an infraction type', 'error');
      return;
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast('Enter an amount greater than zero', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/fines', { memberId: member._id, typeId, amount: n, date });
      toast(`Fine issued to ${member.name}`);
      setOpenId(null);
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loader />;

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Discipline</p>
        <h1 className="mt-1 text-2xl font-bold">Issue a disciplinary fine</h1>
      </header>

      <input
        type="search"
        placeholder="Search name, phone or reg number"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-12 w-full rounded-xl border border-rule bg-surface px-4 text-sm"
        aria-label="Search members"
      />

      {types.length === 0 ? (
        <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
          No disciplinary fine types set up yet.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
          No members match that search.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
          {filtered.map((m) => (
            <li key={m._id} className="border-b border-rule last:border-b-0">
              <button
                type="button"
                onClick={() => openFor(m)}
                aria-pressed={openId === m._id}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left"
              >
                <span className="min-w-0 truncate text-sm font-medium">{m.name}</span>
                <span className="shrink-0 text-xs font-medium text-primary">
                  {openId === m._id ? 'Close' : 'Add fine'}
                </span>
              </button>
              {openId === m._id && (
                <div className="space-y-3 border-t border-rule bg-canvas px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {types.map((t) => (
                      <button
                        key={t._id}
                        type="button"
                        onClick={() => selectType(t)}
                        aria-pressed={typeId === t._id}
                        className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${
                          typeId === t._id ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
                        }`}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Amount (Ksh)"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="amount h-11 w-full rounded-lg border border-rule bg-surface px-3 text-sm"
                    aria-label={`Amount for ${m.name}`}
                  />
                  <input
                    type="date"
                    max={todayISO()}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-11 w-full rounded-lg border border-rule bg-surface px-3 text-sm"
                    aria-label={`Date for ${m.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => issue(m)}
                    disabled={busy}
                    className="min-h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {busy ? 'Issuing…' : 'Issue fine'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
