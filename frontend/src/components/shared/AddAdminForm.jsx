import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from './Toast';

// Super-admin only: create admins and deactivate/reactivate them.
// Deliberately a small form, not a management page — this system
// will only ever have 2-3 admin accounts.
export default function AddAdminForm() {
  const { user } = useAuth();
  const toast = useToast();
  const [admins, setAdmins] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);

  async function loadAdmins() {
    try {
      const res = await api.get('/api/auth/admins');
      setAdmins(res.data.admins);
    } catch {
      // Non-fatal; the list simply stays empty
    }
  }

  useEffect(() => {
    loadAdmins();
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/auth/admins', form);
      toast('Admin added');
      setForm({ name: '', email: '', password: '' });
      loadAdmins();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(admin) {
    try {
      await api.patch(`/api/auth/admins/${admin.id}`, { active: !admin.active });
      toast(admin.active ? 'Admin deactivated' : 'Admin reactivated');
      loadAdmins();
    } catch (err) {
      toast(apiMessage(err), 'error');
    }
  }

  return (
    <section className="rounded-xl border border-rule bg-surface p-5">
      <h2 className="text-base font-semibold">Admin accounts</h2>

      <ul className="mt-3 divide-y divide-rule">
        {admins.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {a.name}
                {a.role === 'super_admin' && (
                  <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-accent">
                    Super
                  </span>
                )}
                {!a.active && (
                  <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                    Inactive
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-muted">{a.email}</p>
            </div>
            {a.role !== 'super_admin' && a.id !== user.id && (
              <button
                type="button"
                onClick={() => toggleActive(a)}
                className="min-h-11 shrink-0 rounded-lg border border-rule px-3 text-xs font-medium"
              >
                {a.active ? 'Deactivate' : 'Reactivate'}
              </button>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-rule pt-4">
        <p className="text-sm font-medium">Add admin</p>
        <input
          type="text"
          required
          placeholder="Full name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Full name"
        />
        <input
          type="email"
          required
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Email"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password (min 8 characters)"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Password"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-primary text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Adding…' : 'Add admin'}
        </button>
      </form>
    </section>
  );
}
