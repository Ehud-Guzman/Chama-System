import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from './Toast';
import { weakPasswordMessage } from '../../utils/password';

// Admin/super-admin: create admin, secretary or disciplinary accounts,
// deactivate/reactivate them, and reset a locked-out account's password
// (there's no self-serve "forgot password" flow — no email delivery in this
// system, by design). A plain admin can only manage secretary/disciplinary
// accounts; only the super admin can create or manage another admin.
// Deliberately a small form, not a management page — this system will only
// ever have a handful of accounts.
export default function AddAdminForm() {
  const { user } = useAuth();
  const toast = useToast();
  const isSuperAdmin = user?.role === 'super_admin';
  const [admins, setAdmins] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'secretary' });
  const [busy, setBusy] = useState(false);
  const [resettingId, setResettingId] = useState(null);
  const [resetValue, setResetValue] = useState('');

  // A plain admin can only manage secretary/disciplinary accounts, not other admins.
  function canManage(admin) {
    return isSuperAdmin || ['secretary', 'disciplinary'].includes(admin.role);
  }

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
    const weakMessage = weakPasswordMessage(form.password);
    if (weakMessage) {
      toast(weakMessage, 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/auth/admins', form);
      toast(form.role === 'admin' ? 'Admin added' : form.role === 'disciplinary' ? 'Disciplinary officer added' : 'Secretary added');
      setForm({ name: '', email: '', password: '', role: 'secretary' });
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

  async function saveReset(admin) {
    const weakMessage = weakPasswordMessage(resetValue);
    if (weakMessage) {
      toast(weakMessage, 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/auth/admins/${admin.id}/reset-password`, { password: resetValue });
      toast(`Password reset for ${admin.name}`);
      setResettingId(null);
      setResetValue('');
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="relative z-40 rounded-xl border border-rule bg-surface p-5">
      <h2 className="text-base font-semibold">Admin &amp; other accounts</h2>

      <ul className="mt-3 divide-y divide-rule">
        {admins.map((a) => (
          <li key={a.id} className="py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {a.name}
                  {a.role === 'super_admin' && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-accent">
                      Super
                    </span>
                  )}
                  {a.role === 'secretary' && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-primary">
                      Secretary
                    </span>
                  )}
                  {a.role === 'disciplinary' && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-alert">
                      Disciplinary
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
              {a.id !== user.id && canManage(a) && (
                <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setResettingId(resettingId === a.id ? null : a.id);
                      setResetValue('');
                    }}
                    className="min-h-11 flex-1 rounded-lg border border-rule px-3 text-xs font-medium transition hover:bg-elevation sm:flex-none"
                  >
                    Reset password
                  </button>
                  {a.role !== 'super_admin' && (
                    <button
                      type="button"
                      onClick={() => toggleActive(a)}
                      className="min-h-11 flex-1 rounded-lg border border-rule px-3 text-xs font-medium transition hover:bg-elevation sm:flex-none"
                    >
                      {a.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </div>
              )}
            </div>
            {resettingId === a.id && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="password"
                  autoFocus
                  minLength={8}
                  placeholder="New password (letters & numbers, min 8 chars)"
                  value={resetValue}
                  onChange={(e) => setResetValue(e.target.value)}
                  className="h-11 w-full rounded-lg border border-rule px-3 text-sm sm:flex-1"
                  aria-label={`New password for ${a.name}`}
                />
                <div className="flex gap-2 sm:shrink-0">
                  <button
                    type="button"
                    onClick={() => saveReset(a)}
                    disabled={busy}
                    className="min-h-11 flex-1 rounded-lg bg-primary px-3 text-xs font-semibold text-white transition disabled:opacity-60 hover:bg-opacity-90 sm:flex-none"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setResettingId(null)}
                    className="min-h-11 flex-1 rounded-lg border border-rule px-3 text-xs font-medium transition hover:bg-elevation sm:flex-none"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-rule pt-4">
        <p className="text-sm font-medium">Add account</p>
        {isSuperAdmin && (
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="h-12 w-full rounded-xl border border-rule px-4 text-sm transition focus:border-primary focus:outline-none"
            aria-label="Role"
          >
            <option value="secretary">Secretary</option>
            <option value="disciplinary">Disciplinary officer</option>
            <option value="admin">Admin</option>
          </select>
        )}
        <input
          type="text"
          required
          placeholder="Full name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm transition focus:border-primary focus:outline-none"
          aria-label="Full name"
        />
        <input
          type="email"
          required
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm transition focus:border-primary focus:outline-none"
          aria-label="Email"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password (letters & numbers, min 8 chars)"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm transition focus:border-primary focus:outline-none"
          aria-label="Password"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-primary text-sm font-semibold text-white transition disabled:opacity-60 hover:bg-opacity-90"
        >
          {busy ? 'Adding…' : form.role === 'admin' ? 'Add admin' : form.role === 'disciplinary' ? 'Add disciplinary officer' : 'Add secretary'}
        </button>
      </form>
    </section>
  );
}