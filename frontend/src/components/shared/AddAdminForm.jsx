import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from './Toast';
import AddAccountModal from './AddAccountModal';

// Admin/super-admin: manage admin, secretary, treasurer, and disciplinary accounts
// (there's no self-serve "forgot password" flow — no email delivery in this
// system, by design). A plain admin can only manage secretary/treasurer/disciplinary
// accounts; only the super admin can create or manage another admin.
export default function AddAdminForm() {
  const { user } = useAuth();
  const toast = useToast();
  const isSuperAdmin = user?.role === 'super_admin';
  const [admins, setAdmins] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [resettingId, setResettingId] = useState(null);
  const [resetValue, setResetValue] = useState('');
  const [busy, setBusy] = useState(false);

  // A plain admin can manage secretary/treasurer/disciplinary accounts, not other admins.
  function canManage(admin) {
    return isSuperAdmin || ['secretary', 'treasurer', 'disciplinary'].includes(admin.role);
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
    const minLength = 8;
    if (!resetValue || resetValue.length < minLength) {
      toast('Password must be at least 8 characters', 'error');
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
    <section className="rounded-xl border border-rule bg-surface p-5">
      <h2 className="text-base font-semibold">Admin &amp; other accounts</h2>

      <ul className="mt-3 divide-y divide-rule">
        {admins.map((a) => (
          <li key={a.id} className="py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {a.name}
                  {a.role === 'super_admin' && (
                    <span className="ml-2 text-[11px] font-semibold uppercase tracking-widest text-accent">
                      Super
                    </span>
                  )}
                  {a.role === 'secretary' && (
                    <span className="ml-2 text-[11px] font-semibold uppercase tracking-widest text-primary">
                      Secretary
                    </span>
                  )}
                  {a.role === 'disciplinary' && (
                    <span className="ml-2 text-[11px] font-semibold uppercase tracking-widest text-alert">
                      Disciplinary
                    </span>
                  )}
                  {a.role === 'treasurer' && (
                    <span className="ml-2 text-[11px] font-semibold uppercase tracking-widest text-accent">
                      Treasurer
                    </span>
                  )}
                  {!a.active && (
                    <span className="ml-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
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

      <button
        type="button"
        onClick={() => setShowAddModal(true)}
        className="mt-4 min-h-12 w-full rounded-lg bg-primary py-3 text-sm font-semibold text-white transition hover:bg-opacity-90"
      >
        + Add account
      </button>

      <AddAccountModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onAdded={loadAdmins} />
    </section>
  );
}