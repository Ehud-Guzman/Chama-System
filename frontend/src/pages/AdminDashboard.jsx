import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { money } from '../utils/format';
import AddAdminForm from '../components/shared/AddAdminForm';
import ChamaSettingsForm from '../components/shared/ChamaSettingsForm';
import TypeManager from '../components/contributions/TypeManager';
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
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Total contributed" value={money(summary.totalContributed)} accent />
            <StatTile label="Active members" value={summary.activeMembers} />
            <StatTile label="Yet to contribute" value={summary.membersWithZeroContributions} />
            <StatTile label="Entries" value={summary.contributionCount} />
          </section>
        )
      )}

      <div className="grid grid-cols-2 gap-3 md:max-w-md">
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

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <ChamaSettingsForm />
        <TypeManager />
        {user?.role === 'super_admin' && <AddAdminForm />}
      </div>
    </div>
  );
}
