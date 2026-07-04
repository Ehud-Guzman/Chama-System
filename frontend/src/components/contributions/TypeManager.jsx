import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { money } from '../../utils/format';

// Any admin can manage contribution types — this is operational data
// (what the group is collecting for), not an account-management action.
export default function TypeManager({ onChange }) {
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({
    name: '',
    description: '',
    isWeekly: false,
    weeklyAmount: '',
    tracksExpenses: false,
  });
  const [busy, setBusy] = useState(false);
  const [editingWeeklyId, setEditingWeeklyId] = useState(null);
  const [weeklyValue, setWeeklyValue] = useState('');

  async function load() {
    try {
      const res = await api.get('/api/types', { params: { all: true } });
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
      await api.post('/api/types', {
        ...form,
        weeklyAmount: form.isWeekly ? Number(form.weeklyAmount) || 0 : 0,
      });
      toast('Contribution type added');
      setForm({ name: '', description: '', isWeekly: false, weeklyAmount: '', tracksExpenses: false });
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
      await api.patch(`/api/types/${type._id}`, { active: !type.active });
      toast(type.active ? 'Type deactivated' : 'Type reactivated');
      load();
      onChange?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    }
  }

  async function saveWeeklyAmount(type) {
    const n = Number(weeklyValue);
    if (!Number.isFinite(n) || n < 0) {
      toast('Enter a weekly amount of zero or more', 'error');
      return;
    }
    try {
      await api.patch(`/api/types/${type._id}`, { weeklyAmount: n });
      setEditingWeeklyId(null);
      load();
      onChange?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    }
  }

  return (
    <section className="rounded-xl border border-rule bg-surface p-5">
      <h2 className="text-base font-semibold">Contribution types</h2>
      <p className="mt-1 text-xs text-muted">
        What members are contributing towards — e.g. Welfare, Development, Monthly Savings.
      </p>

      {types.length > 0 && (
        <ul className="mt-3 divide-y divide-rule">
          {types.map((t) => (
            <li key={t._id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.name}
                    {!t.active && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                        Inactive
                      </span>
                    )}
                    {t.isWeekly && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-primary">
                        Weekly
                      </span>
                    )}
                    {t.tracksExpenses && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-accent">
                        Fund
                      </span>
                    )}
                  </p>
                  {t.description && <p className="truncate text-xs text-muted">{t.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => toggleActive(t)}
                  className="min-h-11 shrink-0 rounded-lg border border-rule px-3 text-xs font-medium"
                >
                  {t.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>

              {t.isWeekly && (
                <div className="mt-2">
                  {editingWeeklyId === t._id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        autoFocus
                        value={weeklyValue}
                        onChange={(e) => setWeeklyValue(e.target.value)}
                        className="amount h-10 w-28 rounded-lg border border-rule px-3 text-sm"
                        aria-label={`Weekly amount for ${t.name}`}
                      />
                      <button
                        type="button"
                        onClick={() => saveWeeklyAmount(t)}
                        className="min-h-10 rounded-lg bg-primary px-3 text-xs font-semibold text-white"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingWeeklyId(null)}
                        className="min-h-10 rounded-lg border border-rule px-3 text-xs font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingWeeklyId(t._id);
                        setWeeklyValue(String(t.weeklyAmount || ''));
                      }}
                      className="amount text-xs font-medium text-primary"
                    >
                      {money(t.weeklyAmount)} / week — edit
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-rule pt-4">
        <p className="text-sm font-medium">Add type</p>
        <input
          type="text"
          required
          placeholder="Name, e.g. Development Fund"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Type name"
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Type description"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isWeekly}
            onChange={(e) => setForm({ ...form, isWeekly: e.target.checked })}
          />
          Fixed weekly due (e.g. the 1,400 contribution, the 100 Chai fee)
        </label>
        {form.isWeekly && (
          <input
            type="text"
            inputMode="numeric"
            placeholder="Amount due per week, e.g. 1400"
            value={form.weeklyAmount}
            onChange={(e) => setForm({ ...form, weeklyAmount: e.target.value })}
            className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
            aria-label="Weekly amount"
          />
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.tracksExpenses}
            onChange={(e) => setForm({ ...form, tracksExpenses: e.target.checked })}
          />
          Tracks expenses (e.g. Chai fund spent on refreshments)
        </label>
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-primary text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Adding…' : 'Add type'}
        </button>
      </form>
    </section>
  );
}
