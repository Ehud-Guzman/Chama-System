import { useEffect, useState } from 'react';
import api from '../../services/api';
import { money } from '../../utils/format';

// Loads automatically for anyone who opens the link — no phone number needed.
// This is the group-wide half of "open book": who the chama is, how many
// members it has (and has ever had), and what's been raised per fund.
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
    <section className="mt-6 overflow-hidden rounded-xl border border-rule bg-surface shadow-sm">
      <header className="border-b border-rule px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Group overview
        </p>
        <p className="amount mt-1 text-sm">
          <span className="font-semibold">{overview.activeMembers}</span> active members
          <span className="text-muted"> · {overview.totalMembersEver} registered all-time</span>
        </p>
      </header>

      {overview.byType.length > 0 && (
        <div className="px-5 py-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
            Raised by contribution type
          </p>
          <ul className="space-y-2">
            {overview.byType.map((t) => (
              <li key={t.name} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{t.name}</span>
                <span className="amount shrink-0 font-medium">{money(t.totalContributed)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="border-t border-rule bg-primary/5 px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Total raised, all funds
        </p>
        <p className="amount mt-1 text-2xl font-bold text-primary">
          {money(overview.totalContributed)}
        </p>
      </footer>
    </section>
  );
}
