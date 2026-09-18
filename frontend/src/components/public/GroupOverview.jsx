import { useEffect, useState } from 'react';
import api from '../../services/api';
import { money } from '../../utils/format';
import StatTile from '../shared/StatTile';

// Group-wide totals for anyone who opens the link — no phone number needed, and
// no per-member data in it at all: no name, no balance, no phone number. A
// member's own record is opened by proving his own number on the lookup above,
// never by browsing a list of people.
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
  <StatTile label="Active members" value={overview.activeMembers} />
  <StatTile label="Registered all-time" value={overview.totalMembersEver} />
  <StatTile
    label="Total raised (all-time)"
    value={money(overview.totalContributed)}
    hint={
      overview.carriedIn > 0
        ? `${money(overview.carriedIn)} carried forward · ${money(overview.collected)} since the books opened`
        : undefined
    }
  />
  <StatTile
    label="Cash held now"
    value={money(overview.netBalance)}
    accent
  />
</div>
<p className="mt-3 max-w-3xl text-xs leading-5 text-muted">
  "Total raised" is everyone's lifetime contributions added up, including the{" "}
  {money(overview.carriedIn)} the members and the funds already held when the books opened. "Cash
  held now" is that total minus {money(overview.totalExpenses)} spent from tracked funds — the
  closer answer to "how much does the group actually have."
  {overview.finesCollected > 0 && (
    <> It also excludes {money(overview.finesCollected)} collected from fines, which the group holds but isn't logged as a contribution.</>
  )}
  {overview.carriedInMemberBalances > 0 && (
    <> Of that, {money(overview.carriedInMemberBalances)} is the members&rsquo; own brought-forward money: it is held for them, so it sits in &ldquo;Total raised&rdquo; and in no fund below.</>
  )}
</p>

      {/* The two per-name breakdowns sit side by side from lg. As full-width
          cards every amount sat a screen away from the label it belongs to, so
          the width was there but the pairing was unreadable. Each list is a
          single column inside its own card instead. */}
      {(overview.byType.length > 0 || overview.fundBalances?.length > 0) && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {overview.byType.length > 0 && (
            <div className="rounded-xl border border-rule bg-surface p-4 md:p-5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                By contribution type (carried in + collected)
              </p>
              <ul className="space-y-2">
                {overview.byType.map((t) => (
                  <li key={t.name} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{t.name}</span>
                    <span className="amount shrink-0 text-right font-medium">
                      {money(t.total ?? t.totalContributed)}
                      {/* A type can hold money with no row against it: it was
                          already on the books when the ledger opened, keyed in on
                          the go-live screen. Named here so the figure traces back
                          to that sheet instead of looking invented. */}
                      {t.carriedIn > 0 && (
                        <span className="block text-xs font-normal text-muted">
                          incl. {money(t.carriedIn)} carried in
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {overview.fundBalances?.length > 0 && (
            <div className="rounded-xl border border-rule bg-surface p-4 md:p-5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                Fund balances (what each fund holds)
              </p>
              <ul className="space-y-2">
                {overview.fundBalances.map((f) => (
                  <li key={f.name} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{f.name}</span>
                    {/* Just the balance, with the part that was carried in named
                        underneath — every fund the group holds money in, and no
                        Tea Fund (the Group's own automatic deduction). */}
                    <span className="amount shrink-0 text-right font-medium">
                      {money(f.balance)}
                      {f.carriedIn > 0 && (
                        <span className="block text-xs font-normal text-muted">
                          incl. {money(f.carriedIn)} carried in
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
