import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { money } from '../utils/format';

import AddAdminForm from '../components/shared/AddAdminForm';
import ChangePasswordForm from '../components/shared/ChangePasswordForm';
import ChamaSettingsForm from '../components/shared/ChamaSettingsForm';
import TypeManager from '../components/contributions/TypeManager';
import FineTypeManager from '../components/contributions/FineTypeManager';
import ExpensesPanel from '../components/shared/ExpensesPanel';
import StatTile from '../components/shared/StatTile';
import Loader from '../components/shared/Loader';

export default function AdminDashboard() {
  const { user } = useAuth();
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
    <div className="min-w-0 space-y-5 sm:space-y-6">

      {/* =====================================================
          HEADER
          ===================================================== */}
      <header className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted sm:text-xs">
          Dashboard
        </p>

        <h1 className="mt-1 break-words text-2xl font-bold leading-tight sm:text-3xl">
          Hello, {firstName}
        </h1>

        <p className="mt-1 text-sm text-muted">
          Here's what's happening with the chama.
        </p>
      </header>

      {/* =====================================================
          STATISTICS
          Mobile: 1 column
          Small screens: 2 columns
          Desktop: 5 columns
          ===================================================== */}
      {loading ? (
        <div className="rounded-2xl border border-rule bg-surface p-6">
          <Loader />
        </div>
      ) : (
        summary && (
          <section
            aria-label="Chama summary"
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            <div className="min-w-0 sm:col-span-2 lg:col-span-1">
              <StatTile
                label="Total contributed (all-time)"
                value={money(summary.totalContributed)}
                accent
              />
            </div>

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
                label="Entries"
                value={summary.contributionCount}
              />
            </div>
          </section>
        )
      )}

      {/* =====================================================
          QUICK ACTIONS
          ===================================================== */}
      <section aria-label="Quick actions">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:max-w-xl">
          <Link
            to="/admin/log"
            className="
              flex min-h-[52px] w-full items-center justify-center
              rounded-xl bg-primary px-4 py-3
              text-sm font-semibold text-white
              shadow-sm transition
              active:scale-[0.98]
              hover:opacity-95
            "
          >
            Log contribution
          </Link>

          <Link
            to="/admin/members"
            className="
              flex min-h-[52px] w-full items-center justify-center
              rounded-xl border border-rule bg-surface px-4 py-3
              text-sm font-semibold
              transition
              active:scale-[0.98]
              hover:bg-muted/5
            "
          >
            Members
          </Link>
        </div>
      </section>

      {/* =====================================================
          ADMIN MANAGEMENT PANELS
          Mobile: one column
          Desktop: two columns
          ===================================================== */}
      <section
        aria-label="Administration"
        className="
          grid min-w-0 grid-cols-1 gap-4
          lg:grid-cols-2
          lg:items-start
        "
      >
        {/* Chama settings */}
        <div className="min-w-0">
          <ChamaSettingsForm />
        </div>

        {/* Contribution types */}
        <div className="min-w-0">
          <TypeManager />
        </div>

        {/* Fine types */}
        <div className="min-w-0">
          <FineTypeManager />
        </div>

        {/* Expenses */}
        <div className="min-w-0">
          <ExpensesPanel />
        </div>

        {/* Password */}
        <div className="min-w-0">
          <ChangePasswordForm />
        </div>

        {/* Super admin */}
        {user?.role === 'super_admin' && (
          <div className="min-w-0">
            <AddAdminForm />
          </div>
        )}
      </section>
    </div>
  );
}