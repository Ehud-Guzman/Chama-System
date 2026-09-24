import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { money, shortDate } from '../../utils/format';

// What the group is owed in fines, on the dashboard, with one tap into the screen that
// works them.
//
// It exists because the two questions an office asks about fines are different: "how
// much are we owed?" belongs next to the week's figures, and "who, and for what?" is a
// list somebody works down. The first is this card; the second is /admin/fines, which
// this opens.
//
// It draws nothing at all for a role that may not read a financial fine (the treasurer,
// the disciplinary officer), and nothing when the request fails: the dashboard's job is
// the ledger, and a second request that failed should not put an error on a screen
// whose own figures loaded fine.
export default function FinesSummaryCard() {
  const { user } = useAuth();
  const mayReadFines = ['super_admin', 'admin'].includes(user?.role);
  const [totals, setTotals] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!mayReadFines) return;
    let cancelled = false;
    api
      .get('/api/fines/summary')
      .then((res) => {
        if (!cancelled) setTotals(res.data?.totals || null);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mayReadFines]);

  if (!mayReadFines || failed || !totals) return null;

  const owed = Number(totals.outstanding) || 0;
  const membersOwing = Number(totals.membersOwing) || 0;

  return (
    <section className="rounded-xl border border-rule bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Fines owed</p>
        <Link to="/admin/fines" className="text-sm font-medium text-primary">
          Work them →
        </Link>
      </div>

      <p className={`amount mt-1 text-lg font-bold ${owed > 0 ? 'text-alert' : 'text-primary'}`}>
        {money(owed)}
      </p>

      <p className="amount mt-1 text-[11px] leading-4 text-muted">
        {owed > 0
          ? `${totals.pendingCount} ${totals.pendingCount === 1 ? 'fine' : 'fines'} across ${membersOwing} ${
              membersOwing === 1 ? 'member' : 'members'
            }${
              totals.oldestUnpaid ? ` · oldest since ${shortDate(totals.oldestUnpaid)}` : ''
            }`
          : 'Every fine issued has been cleared.'}
      </p>

      <p className="amount mt-2 border-t border-rule pt-2 text-[11px] text-muted">
        {money(totals.cleared)} paid off so far
      </p>
    </section>
  );
}
