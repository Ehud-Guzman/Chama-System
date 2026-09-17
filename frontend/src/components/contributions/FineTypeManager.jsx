import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { money } from '../../utils/format';

// Same pattern as TypeManager, against fine types instead of contribution
// types. Two categories: 'financial' (treasurer-issued, e.g. Late payment)
// and 'disciplinary' (the disciplinary officer's fixed infraction list —
// Lateness, Absence, etc.), each with its own default penalty amount.
export default function FineTypeManager({ onChange }) {
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ name: '', description: '', category: 'financial', defaultAmount: '' });
  const [busy, setBusy] = useState(false);
  const [editingAmountId, setEditingAmountId] = useState(null);
  const [amountValue, setAmountValue] = useState('');

  async function load() {
    try {
      const res = await api.get('/api/fine-types', { params: { all: true } });
      setTypes(res.data.types);
    } catch {
      // Non-fatal; the list simply stays empty
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/fine-types', form);
      toast('Fine type added');
      setForm({ name: '', description: '', category: 'financial', defaultAmount: '' });
      load();
      onChange?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(type) {
    try {
      await api.patch(`/api/fine-types/${type._id}`, { active: !type.active });
      toast(type.active ? 'Type deactivated' : 'Type reactivated');
      load();
      onChange?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    }
  }

  async function saveAmount(type) {
    const n = Number(amountValue);
    if (!Number.isFinite(n) || n < 0) {
      toast('Enter a default amount of zero or more', 'error');
      return;
    }
    try {
      await api.patch(`/api/fine-types/${type._id}`, { defaultAmount: n });
      setEditingAmountId(null);
      load();
      onChange?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    }
  }

  return (
    <section className="rounded-xl border border-rule bg-surface p-5">
      <h2 className="text-base font-semibold">Fine types</h2>
      <p className="mt-1 text-xs text-muted">
        Financial fines (treasurer, e.g. Late payment) and disciplinary infractions (disciplinary
        officer, e.g. Lateness, Absence) — each with its own default penalty amount.
      </p>

      {types.length > 0 && (
        <ul className="mt-3 divide-y divide-rule">
          {types.map((t) => (
            <li key={t._id} className="py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  {/* Name and category sit in their own wrapping row so the
                      category can never be truncated away along with the name. */}
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <p className="break-words text-sm font-medium">{t.name}</p>
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-widest ${
                        t.category === 'disciplinary' ? 'text-primary' : 'text-accent'
                      }`}
                    >
                      {t.category === 'disciplinary' ? 'Disciplinary' : 'Financial'}
                    </span>
                    {!t.active && (
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                        Inactive
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p className="mt-0.5 break-words text-xs text-muted">{t.description}</p>
                  )}
                </div>
                {/* The two states carry different visual weight on purpose:
                    taking a type out of use is the cautious action, so it reads
                    as a danger outline, while bringing one back is the
                    constructive one and reads as the primary button. */}
                <button
                  type="button"
                  onClick={() => toggleActive(t)}
                  className={`min-h-11 w-full rounded-lg px-3 text-xs font-semibold lg:w-auto lg:shrink-0 ${
                    t.active
                      ? 'border border-alert/40 text-alert hover:bg-alert/5'
                      : 'bg-primary text-white hover:bg-primary-dark'
                  }`}
                >
                  {t.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>

              <div className="mt-2">
                {editingAmountId === t._id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoFocus
                      value={amountValue}
                      onChange={(e) => setAmountValue(e.target.value)}
                      className="amount h-10 w-28 rounded-lg border border-rule px-3 text-sm"
                      aria-label={`Default amount for ${t.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => saveAmount(t)}
                      className="min-h-11 rounded-lg bg-primary px-3 text-xs font-semibold text-white"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingAmountId(null)}
                      className="min-h-11 rounded-lg border border-rule px-3 text-xs font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingAmountId(t._id);
                      setAmountValue(String(t.defaultAmount || ''));
                    }}
                    className="amount inline-flex min-h-11 items-center text-xs font-medium text-primary"
                  >
                    {t.defaultAmount > 0 ? `${money(t.defaultAmount)} default — edit` : 'No default amount — set one'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-rule pt-4">
        <p className="text-sm font-medium">Add fine type</p>
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Fine type category"
        >
          <option value="financial">Financial (treasurer)</option>
          <option value="disciplinary">Disciplinary (disciplinary officer)</option>
        </select>
        <input
          type="text"
          required
          placeholder="Name, e.g. Late payment"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Fine type name"
        />
        <input
          type="text"
          inputMode="numeric"
          placeholder="Default amount (optional)"
          value={form.defaultAmount}
          onChange={(e) => setForm({ ...form, defaultAmount: e.target.value })}
          className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Default amount"
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Fine type description"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-primary text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Adding…' : 'Add fine type'}
        </button>
      </form>
    </section>
  );
}
