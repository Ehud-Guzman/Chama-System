import { Link } from 'react-router-dom';
import { money } from '../../utils/format';
import { nationalIdMissing } from '../../utils/nationalId';
import MemberAvatar from './MemberAvatar';
import { warmMemberRecord } from '../../services/prefetch';

// Mobile-first member list: stacked cards, no horizontal-scroll tables.
// Cards flow into columns as the screen widens instead of staying single-file.
// The figure on each card is the member's balance from the same cycle engine the
// finance ledger uses — not a sum of contribution rows, which after go-live is
// only part of the story (the rest is his carried-forward opening balance).
export default function MemberCards({ members }) {
  return (
    <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {members.map((m) => (
        <li key={m._id}>
          <Link
            to={`/admin/members/${m._id}`}
            // The record page is warmed on intent — its chunk and this member's
            // payload — so a tap on a name opens it rather than waiting on it.
            onMouseEnter={() => warmMemberRecord(m._id)}
            onPointerDown={() => warmMemberRecord(m._id)}
            className="flex items-center gap-3 rounded-xl border border-rule bg-surface px-4 py-3"
          >
            <MemberAvatar name={m.name} photoUrl={m.photoUrl} />

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate font-semibold">
                  {m.name}
                  {!m.active && (
                    <span className="ml-2 text-[11px] font-semibold uppercase tracking-widest text-alert">
                      Inactive
                    </span>
                  )}
                </p>
                <p className="amount shrink-0 font-semibold text-accent">
                  {money(m.balance ?? m.totalContributed)}
                </p>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-muted">
                <p className="truncate">
                  <span className="amount">{m.phone}</span>
                  {/* The members' page is opened with the ID, so a card that has
                      none is a member who cannot look himself up: the office sees
                      it here, on the list they are already scanning. */}
                  {nationalIdMissing(m.nationalId) && (
                    <span className="ml-2 font-semibold uppercase tracking-widest text-alert">
                      No ID
                    </span>
                  )}
                </p>
                <p className="shrink-0">
                  {/* The money the group *chases*, not the plain record: a member holding at least
                      the group's own line is not told he is behind (utils/reminderLimit), so his
                      card says so instead of counting weeks at him. `arrears` is still what is
                      uncollected — the pill names it — and an older payload without the chased
                      figure falls back to the plain one rather than claiming he is fine. */}
                  {(() => {
                    const chased = m.chasedArrears ?? m.arrears;
                    if (chased > 0) return `${money(chased)} behind`;
                    if (m.coveredByBalance && m.arrears > 0) return 'Ahead of the cycle';
                    return m.balance ? 'Held for him' : 'Nothing held';
                  })()}
                </p>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
