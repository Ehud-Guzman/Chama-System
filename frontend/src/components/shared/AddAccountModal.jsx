import { useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from './Toast';
import { useModal } from '../../hooks/useModal';
import Modal from './Modal';
import { weakPasswordMessage } from '../../utils/password';

// Modal for adding a new admin/secretary/treasurer/disciplinary account.
//
// Rewritten onto the shared dialog shell: it used to be a bare centred box with no
// height cap, no scroll and no dismiss — so on a phone with the keyboard open for
// the password field, its Cancel/Add buttons were pushed off the screen and the
// only way out was to reload the app.
export default function AddAccountModal({ isOpen, onClose, onAdded }) {
  const { user } = useAuth();
  const toast = useToast();
  const isSuperAdmin = user?.role === 'super_admin';
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'secretary' });
  const [busy, setBusy] = useState(false);
  const containerRef = useModal(isOpen, onClose);

  // Who this dialog may create. The super admin may create any of the four staff
  // roles; a plain admin may only create the two record-keeping ones.
  //
  // Treasurer used to be offered to a plain admin, and the API refused it — and the
  // refusal was confusing, because a role it does not serve was quietly turned into
  // 'admin' and then refused as an admin account. Both halves are fixed: the list
  // below is what the API accepts, and the server now names the role it refuses.
  const availableRoles = isSuperAdmin
    ? ['secretary', 'treasurer', 'disciplinary', 'admin']
    : ['secretary', 'disciplinary'];

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
    <Modal
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add account"
      onBackdropClick={onClose}
    >
      <div
        ref={containerRef}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-rule bg-surface p-6 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Add account</h2>
            <p className="mt-1 text-sm text-muted">Create a new user account</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl leading-none text-muted hover:bg-elevation"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
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
    </Modal>
  );
}
