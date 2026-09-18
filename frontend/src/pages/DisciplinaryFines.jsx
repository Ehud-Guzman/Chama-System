import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate, todayISO } from '../utils/format';
import { blobErrorMessage } from '../utils/blobError';
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
  const [selectedId, setSelectedId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const detailsRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api.get('/api/members', { params: { status: 'active', limit: 500 } }),
      api.get('/api/fine-types', { params: { category: 'disciplinary' } }),
    ])
      .then(([membersRes, typesRes]) => {
        setMembers(membersRes.data.members);
        if (membersRes.data.members.length > 0) setSelectedId(membersRes.data.members[0]._id);
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

  const selectedMember = useMemo(
    () => members.find((m) => m._id === selectedId) || filtered[0] || null,
    [filtered, members, selectedId]
  );

  function selectType(type) {
    setTypeId(type._id);
    setAmount(type.defaultAmount > 0 ? String(type.defaultAmount) : '');
  }

  function selectMember(member) {
    setSelectedId(member._id);
    setDate(todayISO());
    window.setTimeout(() => {
      detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  // The selected member's own fine record, and the two documents built from it.
  // The server narrows both to disciplinary-category fines for this role, so what
  // is on this screen is exactly what the export prints.
  const [record, setRecord] = useState(null);
  const [recordBusy, setRecordBusy] = useState(false);
  const [exporting, setExporting] = useState(null);

  const loadRecord = useCallback(
    async (memberId) => {
      if (!memberId) return;
      setRecordBusy(true);
      try {
        const res = await api.get('/api/fines', { params: { memberId, limit: 100 } });
        setRecord(res.data);
      } catch (err) {
        toast(apiMessage(err, 'Could not load his fine record'), 'error');
      } finally {
        setRecordBusy(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (selectedMember?._id) loadRecord(selectedMember._id);
  }, [selectedMember?._id, loadRecord]);

  // Fetched as a blob rather than linked directly: a bare link that hits an error
  // shows raw JSON in the browser instead of the app's own message.
  async function exportRecord(format) {
    if (!selectedMember) return;
    setExporting(format);
    try {
      const res = await api.get(`/api/fines/member/${selectedMember._id}/export`, {
        params: { format },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fines-${selectedMember.regNumber || selectedMember.name}.${
        format === 'xlsx' ? 'xlsx' : 'pdf'
      }`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(await blobErrorMessage(err, 'Could not export the fine record'), 'error');
    } finally {
      setExporting(null);
    }
  }

  async function issue() {
    if (!selectedMember) {
      toast('Select a member', 'error');
      return;
    }
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
      await api.post('/api/fines', { memberId: selectedMember._id, typeId, amount: n, date });
      toast(`Fine issued to ${selectedMember.name}`);
      // The record below is the officer's own copy of what he has issued, so it
      // reloads with the new fine already in it.
      await loadRecord(selectedMember._id);
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
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
          <section className="overflow-hidden rounded-xl border border-rule bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
              <h2 className="text-sm font-semibold">Members</h2>
              <span className="text-xs text-muted">{filtered.length} shown</span>
            </div>
            {filtered.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">No members match that search.</p>
            ) : (
              <ul className="max-h-80 overflow-y-auto lg:max-h-[34rem]">
                {filtered.map((m) => (
                  <li key={m._id} className="border-b border-rule last:border-b-0">
                    <button
                      type="button"
                      onClick={() => selectMember(m)}
                      aria-pressed={selectedMember?._id === m._id}
                      className={`flex min-h-16 w-full items-center justify-between gap-3 px-4 text-left ${
                        selectedMember?._id === m._id ? 'bg-primary/10' : 'hover:bg-elevation'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{m.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {[m.regNumber, m.phone].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-primary">
                        {selectedMember?._id === m._id ? 'Selected' : 'Select'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside
            ref={detailsRef}
            className="rounded-xl border border-rule bg-surface p-4 lg:sticky lg:top-6 lg:self-start"
          >
            <div className="border-b border-rule pb-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">Fine details</p>
              <h2 className="mt-1 truncate text-lg font-bold">
                {selectedMember ? selectedMember.name : 'Select a member'}
              </h2>
              {selectedMember && (
                <p className="mt-1 truncate text-xs text-muted">
                  {[selectedMember.regNumber, selectedMember.phone].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            <div className="mt-4 space-y-4">
              <fieldset>
                <legend className="mb-2 text-xs font-medium">Infraction</legend>
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
              </fieldset>

              <div>
                <label htmlFor="disciplinary-amount" className="mb-1 block text-xs font-medium">
                  Amount
                </label>
                <input
                  id="disciplinary-amount"
                  type="text"
                  inputMode="numeric"
                  placeholder="Amount (Ksh)"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="amount h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
                  aria-label={selectedMember ? `Amount for ${selectedMember.name}` : 'Fine amount'}
                />
              </div>

              <div>
                <label htmlFor="disciplinary-date" className="mb-1 block text-xs font-medium">
                  Date
                </label>
                <input
                  id="disciplinary-date"
                  type="date"
                  max={todayISO()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
                  aria-label={selectedMember ? `Date for ${selectedMember.name}` : 'Fine date'}
                />
              </div>

              <button
                type="button"
                onClick={issue}
                disabled={busy || !selectedMember}
                className="min-h-12 w-full rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'Issuing…' : 'Issue fine'}
              </button>
            </div>
          </aside>
        </div>
      )}
      {/* His whole fine record, and the document the officer can hand over — to
          the member, or to a meeting that asks what has been issued and what is
          still owed. The server narrows this role's reads to disciplinary fines,
          so the totals here are exactly what the export prints. */}
      {selectedMember && (
        <section className="overflow-hidden rounded-xl border border-rule bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">
                Fine record — {selectedMember.name}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {record?.scopeLabel || 'Disciplinary fines'}
                {record ? ` · ${record.summary.count} on record` : ''}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => exportRecord('pdf')}
                disabled={!record || exporting !== null}
                className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {exporting === 'pdf' ? 'Preparing…' : 'Download PDF'}
              </button>

              <button
                type="button"
                onClick={() => exportRecord('xlsx')}
                disabled={!record || exporting !== null}
                className="min-h-11 rounded-lg border border-rule px-4 text-sm font-semibold disabled:opacity-60"
              >
                {exporting === 'xlsx' ? 'Preparing…' : 'Download Excel'}
              </button>
            </div>
          </div>

          {recordBusy && !record ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Loading his fines…</p>
          ) : !record || record.summary.count === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              No disciplinary fines on record for this member.
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-3 divide-x divide-rule border-b border-rule">
                <div className="min-w-0 px-4 py-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                    On record
                  </dt>
                  <dd className="amount mt-0.5 text-sm font-bold">
                    {record.summary.count}
                  </dd>
                  <dd className="amount text-[11px] text-muted">
                    {money(record.summary.issued)} issued
                  </dd>
                </div>

                <div className="min-w-0 px-4 py-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                    Outstanding
                  </dt>
                  <dd
                    className={`amount mt-0.5 text-sm font-bold ${
                      record.summary.outstanding > 0 ? 'text-alert' : ''
                    }`}
                  >
                    {money(record.summary.outstanding)}
                  </dd>
                  <dd className="amount text-[11px] text-muted">
                    {record.summary.pendingCount} not cleared
                  </dd>
                </div>

                <div className="min-w-0 px-4 py-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                    Cleared
                  </dt>
                  <dd className="amount mt-0.5 text-sm font-bold text-accent">
                    {money(record.summary.cleared)}
                  </dd>
                  <dd className="amount text-[11px] text-muted">
                    {record.summary.clearedCount} paid off
                  </dd>
                </div>
              </dl>

              <ul className="divide-y divide-rule">
                {record.fines.map((fine) => (
                  <li key={fine.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-medium">
                        {fine.type}
                        {fine.category === 'disciplinary' && (
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-muted">
                            conduct
                          </span>
                        )}
                      </p>
                      <p className="amount shrink-0 text-sm font-semibold">
                        {money(fine.amount)}
                      </p>
                    </div>

                    <p className="amount mt-0.5 text-xs text-muted">
                      {shortDate(fine.date)} ·{' '}
                      {fine.status === 'pending' ? (
                        <span className="text-alert">{money(fine.remaining)} still owed</span>
                      ) : (
                        <span className="text-accent">cleared</span>
                      )}
                      {fine.issuedBy ? ` · issued by ${fine.issuedBy}` : ''}
                    </p>

                    {fine.reason && (
                      <p className="mt-1 break-words text-xs leading-5 text-muted">{fine.reason}</p>
                    )}

                    {fine.voided && (
                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-muted">
                        Voided — not owed
                      </p>
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
