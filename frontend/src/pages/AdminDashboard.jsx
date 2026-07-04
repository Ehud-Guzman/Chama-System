import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { money } from '../utils/format';
import AddAdminForm from '../components/shared/AddAdminForm';
import ChamaSettingsForm from '../components/shared/ChamaSettingsForm';
import TypeManager from '../components/contributions/TypeManager';
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

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Dashboard</p>
        <h1 className="mt-1 text-2xl font-bold">Hello, {user?.name?.split(' ')[0]}</h1>
      </header>

      {loading ? (
        <Loader />
      ) : (
        summary && (
          <section className="rounded-xl border border-rule bg-surface p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Total contributed
            </p>
            <p className="amount mt-1 text-3xl font-bold text-primary">
              {money(summary.totalContributed)}
            </p>
            <div className="mt-4 flex gap-6 border-t border-rule pt-4 text-sm">
              <div>
                <p className="amount font-semibold">{summary.activeMembers}</p>
                <p className="text-xs text-muted">Active members</p>
              </div>
              <div>
                <p className="amount font-semibold">{summary.membersWithZeroContributions}</p>
                <p className="text-xs text-muted">Yet to contribute</p>
              </div>
              <div>
                <p className="amount font-semibold">{summary.contributionCount}</p>
                <p className="text-xs text-muted">Entries</p>
              </div>
            </div>
          </section>
        )
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/admin/log"
          className="flex min-h-14 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-white"
        >
          Log contribution
        </Link>
        <Link
          to="/admin/members"
          className="flex min-h-14 items-center justify-center rounded-xl border border-rule bg-surface px-4 text-sm font-semibold"
        >
          Members
        </Link>
      </div>

      <ChamaSettingsForm />

      <TypeManager />

      {user?.role === 'super_admin' && <AddAdminForm />}
    </div>
  );
}
