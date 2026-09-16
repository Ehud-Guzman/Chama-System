import { useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from './Toast';
import { weakPasswordMessage } from '../../utils/password';

// Modal for adding a new admin/secretary/treasurer/disciplinary account
export default function AddAccountModal({ isOpen, onClose, onAdded }) {
  const { user } = useAuth();
  const toast = useToast();
  const isSuperAdmin = user?.role === 'super_admin';
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'secretary' });
  const [busy, setBusy] = useState(false);

  // Super admins can create any role. Regular admins can only create secretary/treasurer/disciplinary
  const availableRoles = isSuperAdmin
    ? ['secretary', 'treasurer', 'disciplinary', 'admin']
    : ['secretary', 'treasurer', 'disciplinary'];

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
      const roleLabels = {
        admin: 'Admin',
        secretary: 'Secretary',
        treasurer: 'Treasurer',
        disciplinary: 'Disciplinary officer',
      };
      toast(`${roleLabels[form.role]} added`);
      setForm({ name: '', email: '', password: '', role: 'secretary' });
      onAdded?.();
      onClose();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl border border-rule bg-surface p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Add account</h2>
        <p className="mt-1 text-sm text-muted">Create a new user account</p>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="h-12 w-full rounded-lg border border-rule px-4 text-sm transition focus:border-primary focus:outline-none"
            aria-label="Role"
          >
            {availableRoles.map((role) => {
              const labels = {
                secretary: 'Secretary',
                treasurer: 'Treasurer',
                disciplinary: 'Disciplinary officer',
                admin: 'Admin',
              };
              return (
                <option key={role} value={role}>
                  {labels[role]}
                </option>
              );
            })}
          </select>

          <input
            type="text"
            required
            placeholder="Full name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="h-12 w-full rounded-lg border border-rule px-4 text-sm transition focus:border-primary focus:outline-none"
            aria-label="Full name"
          />

          <input
            type="email"
            required
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="h-12 w-full rounded-lg border border-rule px-4 text-sm transition focus:border-primary focus:outline-none"
            aria-label="Email"
          />

          <input
            type="password"
            required
            minLength={8}
            placeholder="Password (8+ characters)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="h-12 w-full rounded-lg border border-rule px-4 text-sm transition focus:border-primary focus:outline-none"
            aria-label="Password"
          />

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 flex-1 rounded-lg border border-rule px-4 text-sm font-medium transition hover:bg-elevation"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition disabled:opacity-60 hover:bg-opacity-90"
            >
              {busy ? 'Adding…' : 'Add account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
