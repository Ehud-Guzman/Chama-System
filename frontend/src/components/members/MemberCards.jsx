import { Link } from 'react-router-dom';
import { money, shortDate } from '../../utils/format';
import MemberAvatar from './MemberAvatar';

// Mobile-first member list: stacked cards, no horizontal-scroll tables.
// Cards flow into columns as the screen widens instead of staying single-file.
export default function MemberCards({ members }) {
  return (
    <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {members.map((m) => (
        <li key={m._id}>
          <Link
            to={`/admin/members/${m._id}`}
            className="flex items-center gap-3 rounded-xl border border-rule bg-surface px-4 py-3"
          >
            <MemberAvatar name={m.name} photoUrl={m.photoUrl} />

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate font-semibold">
                  {m.name}
                  {!m.active && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-alert">
                      Inactive
                    </span>
                  )}
                </p>
                <p className="amount shrink-0 font-semibold text-accent">
                  {money(m.totalContributed)}
                </p>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-muted">
                <p className="amount truncate">{m.phone}</p>
                <p className="shrink-0">
                  {m.lastContributionDate
                    ? `Last: ${shortDate(m.lastContributionDate)}`
                    : 'No contributions yet'}
                </p>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
