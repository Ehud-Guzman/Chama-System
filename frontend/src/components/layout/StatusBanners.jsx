import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../shared/Toast';
import { apiMessage } from '../../services/api';
import { exitPreview } from '../../services/preview';

// The two states that change what every screen means, said once at the top of every screen.
//
// Maintenance: the super admin has switched the books to read-only for everyone else. Said to
// everybody — a treasurer who is about to type a payment should know before typing, not after a
// refusal — and said differently to the one person it does not apply to.
//
// Preview: the super admin is looking at the app as another role. Written as a bar that stays in
// view, because the failure it prevents is forgetting: finding a "treasurer" screen with no way to
// save and not knowing why.
const ROLE_NAMES = {
  admin: 'an admin',
  treasurer: 'the treasurer',
  secretary: 'the secretary',
  disciplinary: 'the disciplinary officer',
};

export function MaintenanceBanner() {
  const { user, maintenance } = useAuth();
  if (!maintenance) return null;
  const isSuper = user?.role === 'super_admin';
  return (
    <div
      role="status"
      className="mb-4 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm leading-6 text-accent"
    >
      <p className="font-semibold">The system is in maintenance</p>
      <p>
        {maintenance.message ? `${maintenance.message}. ` : ''}
        {isSuper
          ? 'Everyone else can look things up but not save anything. You are not stopped — switch it off in the Control Room when you are done.'
          : 'You can look things up, but nothing can be saved until it is switched off.'}
      </p>
    </div>
  );
}

export function PreviewBar() {
  const { preview, applyMe } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!preview) return null;

  async function exit() {
    setBusy(true);
    try {
      await exitPreview(applyMe);
      navigate('/admin/control');
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[65] flex justify-center px-4 md:bottom-6 md:pl-56"
    >
      <div className="flex w-full max-w-xl items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg">
        <p className="min-w-0 flex-1 leading-5">
          <span className="font-semibold">Previewing as {ROLE_NAMES[preview.role] || preview.role}.</span>{' '}
          <span className="opacity-75">Read-only — nothing you tap here can change anything.</span>
        </p>
        <button
          type="button"
          onClick={exit}
          disabled={busy}
          className="min-h-11 shrink-0 rounded-lg bg-white px-4 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {busy ? 'Leaving…' : 'Exit preview'}
        </button>
      </div>
    </div>
  );
}
