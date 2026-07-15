import { useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from './Toast';

// Every admin can change their own password — this is account hygiene, not
// account management (that's AddAdminForm, super-admin only).
export default function ChangePasswordForm() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (form.newPassword.length < 8) {
      toast('New password must be at least 8 characters', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.patch('/api/auth/me/password', form);
      toast('Password updated');
      setForm({ currentPassword: '', newPassword: '' });
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-rule bg-surface p-5">
      <h2 className="text-base font-semibold">Change my password</h2>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Current password"
          value={form.currentPassword}
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Current password"
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="New password (min 8 characters)"
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="New password"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-primary text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}
