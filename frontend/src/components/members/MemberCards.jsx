import { Link } from 'react-router-dom';
import { money, shortDate } from '../../utils/format';

// Mobile-first member list: stacked cards, no horizontal-scroll tables.
// Cards flow into columns as the screen widens instead of staying single-file.
export default function MemberCards({ members }) {
  return (
    <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {members.map((m) => (
        <li key={m._id}>
          <Link
            to={`/admin/members/${m._id}`}
            className="block rounded-xl border border-rule bg-surface px-4 py-3"
          >
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
              <p className="amount">{m.phone}</p>
              <p>
                {m.lastContributionDate
                  ? `Last: ${shortDate(m.lastContributionDate)}`
                  : 'No contributions yet'}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
