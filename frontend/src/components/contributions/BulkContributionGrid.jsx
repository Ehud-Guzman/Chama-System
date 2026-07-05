import { useEffect, useMemo, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import ConfirmDialog from '../shared/ConfirmDialog';
import { money, todayISO, METHOD_LABELS } from '../../utils/format';

const METHODS = Object.keys(METHOD_LABELS);

function cellKey(memberId, typeId) {
  return `${memberId}:${typeId}`;
}

// One screen for a whole meeting: a row per active member, a column per
// contribution type, cells pre-filled with each isWeekly type's default
// amount (e.g. 100 for Chai). Scan down, edit or clear cells, submit once —
// mirrors the paper ledger's layout instead of one member at a time.
export default function BulkContributionGrid({ onLogged }) {
  const toast = useToast();
  const [members, setMembers] = useState([]);
  const [types, setTypes] = useState([]);
  const [values, setValues] = useState({}); // `${memberId}:${typeId}` -> string
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/api/members', { params: { status: 'active', limit: 100 } }),
      api.get('/api/types'),
    ])
      .then(([membersRes, typesRes]) => {
        const activeMembers = membersRes.data.members;
        const activeTypes = typesRes.data.types;
        setMembers(activeMembers);
        setTypes(activeTypes);

        const initial = {};
        for (const m of activeMembers) {
          for (const t of activeTypes) {
            if (t.isWeekly && t.weeklyAmount > 0) {
              initial[cellKey(m._id, t._id)] = String(t.weeklyAmount);
            }
          }
        }
        setValues(initial);
      })
      .catch((err) => toast(apiMessage(err, 'Could not load members/types'), 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  function setCell(memberId, typeId, raw) {
    setValues((prev) => ({ ...prev, [cellKey(memberId, typeId)]: raw }));
  }

  function fillColumn(type) {
    const amount = type.isWeekly && type.weeklyAmount > 0 ? String(type.weeklyAmount) : '';
    setValues((prev) => {
      const next = { ...prev };
      for (const m of members) next[cellKey(m._id, type._id)] = amount;
      return next;
    });
  }

  function clearColumn(typeId) {
    setValues((prev) => {
      const next = { ...prev };
      for (const m of members) next[cellKey(m._id, typeId)] = '';
      return next;
    });
  }

  const entries = useMemo(() => {
    const list = [];
    for (const m of members) {
      for (const t of types) {
        const raw = values[cellKey(m._id, t._id)];
        const n = Number(String(raw || '').replace(/[,\s]/g, ''));
        if (Number.isFinite(n) && n > 0) {
          list.push({ memberId: m._id, typeId: t._id, amount: n, memberName: m.name, typeName: t.name });
        }
      }
    }
    return list;
  }, [values, members, types]);

  const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);
  const memberCount = new Set(entries.map((e) => e.memberId)).size;

  async function submit() {
    setBusy(true);
    try {
      const res = await api.post('/api/contributions/bulk', {
        date,
        method,
        note: note.trim(),
        entries: entries.map(({ memberId, typeId, amount }) => ({ memberId, typeId, amount })),
      });
      toast(
        res.data.skipped?.length
          ? `Logged ${res.data.created}, skipped ${res.data.skipped.length} — see console for details`
          : `Logged ${res.data.created} contributions`
      );
      if (res.data.skipped?.length) {
        // eslint-disable-next-line no-console
        console.warn('Bulk log skipped rows:', res.data.skipped);
      }
      setConfirming(false);
      onLogged?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading members and types…</p>;
  if (members.length === 0) {
    return <p className="text-sm text-muted">No active members yet.</p>;
  }
  if (types.length === 0) {
    return <p className="text-sm text-muted">No contribution types yet — add one from the Dashboard first.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-rule bg-surface p-4">
        <div>
          <label htmlFor="bulk-date" className="mb-1 block text-xs font-medium">
            Date
          </label>
          <input
            id="bulk-date"
            type="date"
            max={todayISO()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 rounded-lg border border-rule px-3 text-sm"
          />
        </div>
        <fieldset>
          <legend className="mb-1 text-xs font-medium">Method</legend>
          <div className="flex gap-1">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                aria-pressed={method === m}
                className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${
                  method === m ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
                }`}
              >
                {METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="min-w-40 flex-1">
          <label htmlFor="bulk-note" className="mb-1 block text-xs font-medium">
            Note <span className="font-normal text-muted">(applies to all entries)</span>
          </label>
          <input
            id="bulk-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-11 w-full rounded-lg border border-rule px-3 text-sm"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-rule bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule">
              <th className="sticky left-0 z-10 min-w-40 bg-surface px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">
                Member
              </th>
              {types.map((t) => (
                <th key={t._id} className="min-w-32 border-l border-rule px-3 py-2 text-left">
                  <p className="text-xs font-semibold">{t.name}</p>
                  <p className="amount text-[10px] text-muted">
                    {t.isWeekly ? `${money(t.weeklyAmount)}/wk` : 'variable'}
                  </p>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => fillColumn(t)}
                      className="text-[10px] font-medium text-primary"
                    >
                      Fill all
                    </button>
                    <button
                      type="button"
                      onClick={() => clearColumn(t._id)}
                      className="text-[10px] font-medium text-muted"
                    >
                      Clear
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m._id} className="border-b border-rule last:border-b-0">
                <td className="sticky left-0 z-10 min-w-40 bg-surface px-3 py-2">
                  <p className="truncate font-medium">{m.name}</p>
                  {m.regNumber && <p className="amount text-xs text-muted">{m.regNumber}</p>}
                </td>
                {types.map((t) => (
                  <td key={t._id} className="border-l border-rule px-2 py-1.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={values[cellKey(m._id, t._id)] || ''}
                      onChange={(e) => setCell(m._id, t._id, e.target.value)}
                      placeholder="0"
                      aria-label={`${t.name} for ${m.name}`}
                      className="amount h-10 w-24 rounded-lg border border-rule px-2 text-sm"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-rule bg-surface p-4">
        <p className="text-sm text-muted">
          <span className="amount font-semibold text-primary">{entries.length} entries</span> across{' '}
          {memberCount} member{memberCount === 1 ? '' : 's'} — total{' '}
          <span className="amount font-semibold">{money(totalAmount)}</span>
        </p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={entries.length === 0}
          className="min-h-12 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          Log all
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Log this week's contributions?"
        body={`${entries.length} entries across ${memberCount} member${memberCount === 1 ? '' : 's'}, totaling ${money(totalAmount)}.`}
        confirmLabel="Log all"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
