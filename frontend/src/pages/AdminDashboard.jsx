import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { money } from '../utils/format';

import AddAdminForm from '../components/shared/AddAdminForm';
import ChangePasswordForm from '../components/shared/ChangePasswordForm';
import ChamaSettingsForm from '../components/shared/ChamaSettingsForm';
import BackupPanel from '../components/shared/BackupPanel';
import TypeManager from '../components/contributions/TypeManager';
import FineTypeManager from '../components/contributions/FineTypeManager';
import ExpensesPanel from '../components/shared/ExpensesPanel';
import StatTile from '../components/shared/StatTile';
import Loader from '../components/shared/Loader';

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

export default function AdminDashboard() {
  const { user } = useAuth();
  const isTreasurer = user?.role === 'treasurer';
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/api/reports/summary')
      .then((res) => setSummary(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const firstName = user?.name?.split(' ')[0] || 'Admin';

  return (
    <div className="min-w-0 space-y-6">
      {/* Header */}
      <header className="overflow-hidden rounded-xl border border-rule bg-surface">
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:p-6">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted sm:text-xs">
              Dashboard
            </p>
            <h1 className="mt-2 break-words text-2xl font-bold leading-tight sm:text-3xl">
              Hello, {firstName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {isTreasurer
                ? 'Financial overview, contributions, expenses, and member information.'
                : 'A clean view of money, members, records, and the admin tools that keep the chama running.'}
            </p>
          </div>

          {summary && (
            <div className="rounded-xl border border-primary/20 bg-primary/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                Cash held
              </p>
              <p className="amount mt-2 break-words text-3xl font-bold text-primary">
                {money(summary.netBalance)}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted">
                Net of logged expenses.
              </p>
            </div>
          )}
        </div>
      </header>

      {/* Summary stats */}
      {loading ? (
        <div className="rounded-xl border border-rule bg-surface p-6">
          <Loader />
        </div>
      ) : (
        summary && (
          <section
            aria-label="Chama summary"
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <div className="min-w-0">
              <StatTile
                label="This week's total"
                value={money(summary.thisWeekTotal)}
              />
            </div>

            <div className="min-w-0">
              <StatTile
                label="Active members"
                value={summary.activeMembers}
              />
            </div>

            <div className="min-w-0">
              <StatTile
                label="Yet to contribute"
                value={summary.membersWithZeroContributions}
              />
            </div>

            <div className="min-w-0">
              <StatTile
                label="Contribution entries"
                value={summary.contributionCount}
              />
            </div>
          </section>
        )
      )}

      {/* Quick actions */}
      <section aria-label="Quick actions" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Workflows</p>
            <h2 className="mt-1 text-lg font-bold">Quick actions</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction
            to="/admin/log"
            label="Log contribution"
            description="Record payments one by one or in bulk."
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

      {/* System controls */}
      {isAdmin && (
        <section aria-label="Administration" className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Management</p>
            <h2 className="mt-1 text-lg font-bold">System controls</h2>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] xl:items-start">
            {/* Left column */}
            <div className="min-w-0 space-y-4 self-start">
              <ChamaSettingsForm />
              <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
                <TypeManager />
                <FineTypeManager />
              </div>
            </div>

            {/* Right column */}
            <div className="min-w-0 space-y-4 self-start">
              <ExpensesPanel />
              <ChangePasswordForm />
              {user?.role === 'super_admin' && <BackupPanel />}
              {isAdmin && <AddAdminForm />}
            </div>
          </div>
        </section>
      )}

      {/* Treasurer: Financial controls only */}
      {isTreasurer && (
        <section aria-label="Financial controls" className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Management</p>
            <h2 className="mt-1 text-lg font-bold">Financial controls</h2>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
            <TypeManager />
            <ExpensesPanel />
          </div>
          <ChangePasswordForm />
        </section>
      )}
    </div>
  );
}