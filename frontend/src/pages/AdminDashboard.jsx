import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

import AddAdminForm from '../components/shared/AddAdminForm';
import ChangePasswordForm from '../components/shared/ChangePasswordForm';
import ChamaSettingsForm from '../components/shared/ChamaSettingsForm';
import BackupPanel from '../components/shared/BackupPanel';
import FineTypeManager from '../components/contributions/FineTypeManager';
import MemberLedgerList from '../components/ledger/MemberLedgerList';

function QuickAction({ to, label, description, primary }) {
  return (
    <Link
      to={to}
      className={`group flex min-h-24 items-start justify-between gap-4 rounded-xl border p-4 transition active:scale-[0.99] ${
        primary
          ? 'border-primary bg-primary text-white shadow-sm hover:bg-primary-dark'
          : 'border-rule bg-surface hover:border-primary/40 hover:bg-elevation'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold">{label}</span>
        <span className={`mt-1 block text-xs leading-5 ${primary ? 'text-white/80' : 'text-muted'}`}>
          {description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-lg ${
          primary ? 'border-white/25 text-white' : 'border-rule text-primary group-hover:bg-primary/10'
        }`}
      >
        +
      </span>
    </Link>
  );
}

// The dashboard is the logging screen and then the admin tools — deliberately in
// that order. Whoever signs in sees the same week figures and the same list of
// names the treasurer sees, because it is the same component; there is no second
// way to log money anywhere in the app.
export default function AdminDashboard() {
  const { user } = useAuth();
  const isTreasurer = user?.role === 'treasurer';
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);

  const firstName = user?.name?.split(' ')[0] || 'Admin';

  return (
    <div className="min-w-0 space-y-6">
      <header className="rounded-xl border border-rule bg-surface px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted sm:text-xs">
          Dashboard
        </p>
        <h1 className="mt-1 break-words text-2xl font-bold leading-tight sm:text-3xl">
          Hello, {firstName}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          {isTreasurer
            ? 'Pick a member below to log contributions, tea, extra or an expense.'
            : 'Pick a member below to log money, or use the tools further down to keep the records straight.'}
        </p>
      </header>

      {/* The one logging surface, identical to /admin/finance */}
      <MemberLedgerList showHeader />

      <section aria-label="Other workflows" className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Workflows</p>
          <h2 className="mt-1 text-lg font-bold">Other screens</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <QuickAction
            to="/admin/finance/setup"
            label="Opening balances (one-time)"
            description="Key in what each member holds today. Every week is counted from there."
            primary
          />
          <QuickAction
            to="/admin/members"
            label="Members"
            description="Add, update, view statements, and resign members."
          />
          <QuickAction
            to="/admin/reports"
            label="Reports"
            description="Review summaries, performance, audit, and exports."
          />
          {!isTreasurer && (
            <QuickAction
              to="/admin/minutes"
              label="Minutes"
              description="Write, import, export, and manage meeting records."
            />
          )}
        </div>
      </section>

      {isAdmin && (
        <section aria-label="Administration" className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Management</p>
            <h2 className="mt-1 text-lg font-bold">System controls</h2>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] xl:items-start">
            <div className="min-w-0 space-y-4 self-start">
              <ChamaSettingsForm />
              {/* The treasury funds themselves are fixed (weekly contribution,
                  tea, extra) and the week figures live at Finance → Setup, so
                  the only type list left to curate is the infraction list the
                  disciplinary officer picks from. */}
              <FineTypeManager />
            </div>

            <div className="min-w-0 space-y-4 self-start">
              <ChangePasswordForm />
              {user?.role === 'super_admin' && <BackupPanel />}
              <AddAdminForm />
            </div>
          </div>
        </section>
      )}

      {!isAdmin && <ChangePasswordForm />}
    </div>
  );
}
