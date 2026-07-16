import { useMemo } from 'react';
import { money, shortDate } from '../../utils/format';

const STATUS_LABELS = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid' };
const STATUS_CLASSES = {
  paid: 'text-accent',
  partial: 'text-primary',
  unpaid: 'text-alert',
};

// Week-by-week due schedule for one or more fixed weekly contribution types
// (e.g. the 1,400 weekly contribution, the 100 Chai fee), anchored to the
// member's own join date. Shared by the admin member view and the public
// passbook — same shape from GET /api/members/:id and the public profile.
//
// The list of weeks itself needs no admin action to "advance" — the backend
// derives the current week count from the clock every time this is fetched,
// so a new row simply exists as soon as its 7-day window starts. Newest
// week first (like every other ledger in this app) so that growing history
// doesn't push the one week anyone actually cares about further down a
// scrolling list every week that passes.
export default function WeeklyScheduleTable({ schedules }) {
  if (!schedules || schedules.length === 0) return null;

  return (
    <div className="space-y-4">
      {schedules.map((s) => (
        <ScheduleSection key={s.typeId} schedule={s} />
      ))}
    </div>
  );
}

function ScheduleSection({ schedule: s }) {
  const weeksNewestFirst = useMemo(() => [...s.weeks].reverse(), [s.weeks]);
  const currentWeek = s.weeks[s.weeks.length - 1];

  return (
    <section className="overflow-hidden rounded-xl border border-rule bg-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{s.typeName}</p>
          {currentWeek && (
            <p className="amount text-xs text-muted">Currently week {currentWeek.weekNumber}</p>
          )}
        </div>
        <p className="amount shrink-0 text-xs text-muted">{money(s.weeklyAmount)} / week</p>
      </header>
      <div className="max-h-72 overflow-y-auto">
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
          <span>Wk</span>
          <span>Dates</span>
          <span className="text-right">Paid</span>
          <span className="text-right">Status</span>
        </div>
        <ul>
          {weeksNewestFirst.map((w) => (
            <li
              key={w.weekNumber}
              className={`grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 border-t border-rule px-4 py-2 text-sm ${
                w.isCurrent ? 'bg-primary/5' : ''
              }`}
            >
              <span className="amount text-xs text-muted">
                {w.weekNumber}
                {w.isCurrent && (
                  <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                    Now
                  </span>
                )}
              </span>
              <span className="amount text-xs">
                {shortDate(w.startDate)} – {shortDate(w.endDate)}
              </span>
              <span className="amount text-right text-xs font-medium">{money(w.paid)}</span>
              <span className={`text-right text-xs font-semibold ${STATUS_CLASSES[w.status]}`}>
                {STATUS_LABELS[w.status]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
