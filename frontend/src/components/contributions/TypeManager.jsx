import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';

// Any admin can manage contribution types — this is operational data
// (what the group is collecting for), not an account-management action.
export default function TypeManager({ onChange }) {
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ name: '', description: '' });
  const [busy, setBusy] = useState(false);

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
      await api.post('/api/types', form);
      toast('Contribution type added');
      setForm({ name: '', description: '' });
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

  return (
    <section className="rounded-xl border border-rule bg-surface p-5">
      <h2 className="text-base font-semibold">Contribution types</h2>
      <p className="mt-1 text-xs text-muted">
        What members are contributing towards — e.g. Welfare, Development, Monthly Savings.
      </p>

      {types.length > 0 && (
        <ul className="mt-3 divide-y divide-rule">
          {types.map((t) => (
            <li key={t._id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {t.name}
                  {!t.active && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                      Inactive
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
