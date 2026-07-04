import { useEffect, useState } from 'react';
import api from '../../services/api';
import { money } from '../../utils/format';
import StatTile from '../shared/StatTile';

// Loads automatically for anyone who opens the link — no phone number needed.
// This is the group-wide half of "open book": who the chama is, how many
// members it has (and has ever had), and what's been raised per fund.
// Renders as a row of tiles rather than one narrow card so it actually uses
// the width on a desktop screen.
export default function GroupOverview({ onChamaName }) {
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    api
      .get('/api/public/overview')
      .then((res) => {
        setOverview(res.data);
        onChamaName?.(res.data.chamaName);
      })
      .catch(() => {
        // Non-fatal — the page still works for personal lookup without it
      });
  }, [onChamaName]);

  if (!overview) return null;

  return (
    <section>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Active members" value={overview.activeMembers} />
        <StatTile label="Registered all-time" value={overview.totalMembersEver} />
        <StatTile
          label="Total raised, all funds"
          value={money(overview.totalContributed)}
          accent
        />
      </div>

      {overview.byType.length > 0 && (
        <div className="mt-3 rounded-xl border border-rule bg-surface p-4 md:p-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
            Raised by contribution type
          </p>
          <ul className="grid gap-x-6 gap-y-2 md:grid-cols-2">
            {overview.byType.map((t) => (
              <li key={t.name} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{t.name}</span>
                <span className="amount shrink-0 font-medium">{money(t.totalContributed)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {overview.fundBalances?.length > 0 && (
        <div className="mt-3 rounded-xl border border-rule bg-surface p-4 md:p-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
            Fund balances (collected minus spent)
          </p>
          <ul className="grid gap-x-6 gap-y-2 md:grid-cols-2">
            {overview.fundBalances.map((f) => (
              <li key={f.name} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="amount shrink-0 font-medium">{money(f.balance)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
