import { useMemo } from 'react';
import { money, shortDate } from '../../utils/format';

const STATUS_LABELS = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid' };
const STATUS_CLASSES = {
  paid: 'text-accent',
  partial: 'text-primary',
  unpaid: 'text-alert',
};

// Week-by-week due schedule for one or more fixed weekly funds (the weekly
// contribution, the 100 tea), taken from the group's own cycle — week 92 closing
// on its Thursday and advancing every Friday — not from each member's join date.
// Shared by the admin member record and the public passbook.
//
// The list reaches back to week 1 so the numbering reads exactly as the paper
// ledger did, every week closing on a Thursday. The weeks before the cycle
// started are shown as carried forward rather than scored: their money is inside
// the member's opening balance, and scoring them a second time would bill weeks
// that were already paid. They sit behind a toggle because ninety-odd rows would
// bury the week anybody actually cares about — the one running now.
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
  const historyNewestFirst = useMemo(
    () => [...(s.history || [])].reverse(),
    [s.history]
  );
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
              {s.automatic ? (
                <span className="text-right text-xs font-semibold text-muted">Auto</span>
              ) : (
                <span className={`text-right text-xs font-semibold ${STATUS_CLASSES[w.status]}`}>
                  {STATUS_LABELS[w.status]}
                </span>
              )}
            </li>
          ))}
        </ul>

        {historyNewestFirst.length > 0 && (
          <>
            <p className="border-t border-rule bg-canvas px-4 py-3 text-xs leading-5 text-muted">
              Weeks 1–{historyNewestFirst[0].weekNumber} ran before this ledger opened. What was paid in
              them is already inside the member’s carried-forward balance, so they are listed for
              reference and never scored again.
            </p>
            <ul>
              {historyNewestFirst.map((w) => (
                <li
                  key={w.weekNumber}
                  className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 border-t border-rule px-4 py-2 text-sm text-muted"
                >
                  <span className="amount text-xs">{w.weekNumber}</span>
                  <span className="amount text-xs">
                    {shortDate(w.startDate)} – {shortDate(w.endDate)}
                  </span>
                  <span className="text-right text-xs">—</span>
                  <span className="text-right text-xs">Carried forward</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

