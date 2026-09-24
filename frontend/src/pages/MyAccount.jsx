import { useAuth } from '../context/AuthContext';
import { roleHome } from '../utils/roleHome';
import BackLink from '../components/shared/BackLink';
import ChangePasswordForm from '../components/shared/ChangePasswordForm';
import TwoFactorPanel from '../components/shared/TwoFactorPanel';

// One account screen, reachable by every signed-in role.
//
// It exists because two of the five roles had nowhere to go. The password form lived
// on the dashboard (which only the three money roles can open) and on the Settings page
// (which is admin-only), and so did the Security panel — so a treasurer could change
// his password but not enrol a second factor, and a secretary or a disciplinary officer
// could do neither, although the API accepts both from any signed-in account.
//
// Since the group can switch two-factor authentication on for everybody, an account
// screen that everybody can reach is not a convenience: without it, turning the switch
// on protects the admins' accounts and nobody else's.
//
// The role is shown but not editable — a person cannot promote himself, and nothing on
// this page changes what he may reach.
const ROLE_LABELS = {
  super_admin: 'Super admin',
  admin: 'Admin',
  treasurer: 'Treasurer',
  secretary: 'Secretary',
  disciplinary: 'Disciplinary officer',
};

export default function MyAccount() {
  const { user } = useAuth();

  return (
    <div className="min-w-0 space-y-4">
      <header className="min-w-0">
        <BackLink to={roleHome(user?.role)} className="mb-2">
          Back
        </BackLink>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">My account</p>
        <h1 className="mt-1 truncate text-2xl font-bold">{user?.name || 'My account'}</h1>
        <p className="mt-1 truncate text-sm text-muted">{user?.email}</p>
        <p className="mt-1 text-xs text-muted">
          Signed in as {ROLE_LABELS[user?.role] || user?.role}. An admin can change what this
          account may reach.
        </p>
      </header>

      <ChangePasswordForm />
      <TwoFactorPanel />
    </div>
  );
}
