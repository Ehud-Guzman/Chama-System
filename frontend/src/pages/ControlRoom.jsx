import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../services/api';
import BackLink from '../components/shared/BackLink';
import NavTile from '../components/shared/NavTile';
import Loader from '../components/shared/Loader';
import ErrorState from '../components/shared/ErrorState';
import ControlOverview from '../components/control/ControlOverview';
import ControlAccounts from '../components/control/ControlAccounts';
import ControlSwitches from '../components/control/ControlSwitches';
import ControlOverrides from '../components/control/ControlOverrides';
import ControlAudit from '../components/control/ControlAudit';
import ControlData from '../components/control/ControlData';
import ControlPermissions from '../components/control/ControlPermissions';
import ControlDanger from '../components/control/ControlDanger';

// The Control Room: the super admin's one screen for seeing the whole system and putting it right.
//
// Everything on it is the super admin's alone — the API refuses every other role on every route
// behind it, and the route guard only keeps the page out of their way. It is laid out like
// Settings (a rail of sections that jump down the page) because it is the same kind of screen:
// long, rarely opened, and read by someone looking for one thing.
const SECTIONS = [
  { id: 'overview', label: 'Overview', short: 'Overview', hint: 'Health, what needs you, the figures' },
  { id: 'accounts', label: 'Accounts and sessions', short: 'Accounts', hint: 'Sign out, freeze, change a role, preview' },
  { id: 'controls', label: 'Maintenance and switches', short: 'Switches', hint: 'Read-only mode, and what is on or off' },
  { id: 'overrides', label: 'Close the books and fix records', short: 'Books', hint: 'Lock a period, merge, reinstate' },
  { id: 'audit', label: 'Audit powers', short: 'Audit', hint: 'Read entries raw, flag, search by address' },
  { id: 'data', label: 'Backups, restore and jobs', short: 'Backups', hint: 'Copy, restore, schedule' },
  { id: 'permissions', label: 'Who can do what', short: 'Permissions', hint: 'Read from the real rules' },
  { id: 'danger', label: 'Danger zone', short: 'Danger', hint: 'Clear the rehearsal money' },
];

export default function ControlRoom() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.get('/api/superadmin/overview', { timeout: 60000 });
      setOverview(res.data);
      setError('');
    } catch (err) {
      setError(apiMessage(err, 'Could not load the Control Room'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !overview) {
    return <ErrorState title="Could not load the Control Room" message={error} onRetry={load} busy={refreshing} />;
  }
  if (!overview) return <Loader label="Reading the whole system…" />;

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <BackLink to="/admin/dashboard" className="mb-2">
            Back
          </BackLink>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Super admin</p>
          <h1 className="mt-1 text-2xl font-bold">Control Room</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            See the whole system, change what only you can change, and put things right — with every
            action in the audit trail.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          className="min-h-11 shrink-0 rounded-lg border border-rule bg-surface px-4 text-sm font-medium disabled:opacity-60"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start xl:gap-6">
        {/* Eight tall rows would be a whole phone screen of menu before the first thing worth
            reading, so below the wide layout the sections are a strip of short chips; the full
            rows (with their one-line hints) are the rail beside the page on a laptop. */}
        <nav aria-label="On this page" className="min-w-0 xl:hidden">
          <ul className="flex flex-wrap gap-1.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="flex min-h-11 items-center rounded-lg border border-rule bg-surface px-3 text-sm font-medium text-primary"
                >
                  {section.short}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="On this page" className="hidden min-w-0 space-y-2 xl:sticky xl:top-6 xl:order-2 xl:block">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">On this page</h2>
          <ul className="grid min-w-0 gap-1.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <NavTile href={`#${section.id}`} label={section.label} hint={section.hint} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4 xl:order-1">
          <ControlOverview overview={overview} reload={load} />
          <ControlAccounts onChanged={load} />
          <ControlSwitches overview={overview} reload={load} />
          <ControlOverrides overview={overview} reload={load} />
          <ControlAudit onChanged={load} />
          <ControlData overview={overview} reload={load} />
          <ControlPermissions />
          <ControlDanger overview={overview} reload={load} />
        </div>
      </div>
    </div>
  );
}
