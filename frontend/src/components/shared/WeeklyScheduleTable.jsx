import { useMemo, useState } from 'react';
import { money, shortDate } from '../../utils/format';

const STATUS_LABELS = {
  paid: 'Paid in full',
  partial: 'Partly paid',
  unpaid: 'Nothing paid',
  baseline: 'Opening week',
};
const STATUS_CLASSES = {
  paid: 'text-accent',
  partial: 'text-primary',
  unpaid: 'text-alert',
  baseline: 'text-muted',
};

// How many weeks of the cycle show before the reader asks for the rest. The list
// reaches back to week 1 and a cycle is 90-odd weeks long, so an inner scroll box
// was used to keep the page short — but a nested scroller on a phone swallows the
// drag that is trying to scroll the page itself. Recent weeks are what matters; the
// rest is a tap away.
const WEEKS_PREVIEW = 8;

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
  const [showAll, setShowAll] = useState(false);
  const weeksNewestFirst = useMemo(() => [...s.weeks].reverse(), [s.weeks]);
  const historyNewestFirst = useMemo(
    () => [...(s.history || [])].reverse(),
    [s.history]
  );
  const currentWeek = s.weeks[s.weeks.length - 1];
  const shownWeeks = showAll ? weeksNewestFirst : weeksNewestFirst.slice(0, WEEKS_PREVIEW);

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
      <div>
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
          <span>Wk</span>
          <span>Dates</span>
          <span className="text-right">Paid in</span>
          <span className="text-right">Status</span>
        </div>
        <ul>
          {shownWeeks.map((w) => (
            <li
              key={w.weekNumber}
              className={`grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 border-t border-rule px-4 py-2 text-sm ${
                w.isCurrent ? 'bg-primary/5' : ''
              }`}
            >
              <span className="amount text-xs text-muted">
                {w.weekNumber}
                {w.isCurrent && (
                  <span className="ml-1 rounded bg-primary/15 px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                    Now
                  </span>
                )}
              </span>
              <span className="amount text-xs">
                {shortDate(w.startDate)} – {shortDate(w.endDate)}
              </span>
              <span className="amount text-right text-xs font-medium">{money(w.paid)}</span>
              {/* The opening week is the baseline: nothing was due for it and no
                  tea was taken, so it says so rather than "Unpaid" or "Auto". */}
              {w.isBaseline ? (
                <span className="text-right text-xs font-semibold text-muted">Opening week</span>
              ) : s.automatic ? (
                <span className="text-right text-xs font-semibold text-muted">
                  Auto (deducted)
                </span>
              ) : (
                <span className={`text-right text-xs font-semibold ${STATUS_CLASSES[w.status]}`}>
                  {STATUS_LABELS[w.status]}
                </span>
              )}
            </li>
          ))}
        </ul>

        {showAll && historyNewestFirst.length > 0 && (
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
                  <span className="amount text-right text-xs">
                    {w.paid > 0 ? money(w.paid) : '—'}
                  </span>
                  <span className="text-right text-xs">
                    {w.paid > 0 ? 'Paid in that week' : 'Counted in his carried-in money'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {weeksNewestFirst.length > WEEKS_PREVIEW && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="min-h-12 w-full border-t border-rule text-sm font-semibold text-primary"
          >
            {showAll
              ? `Show the last ${WEEKS_PREVIEW} weeks`
              : `Show the whole cycle (week ${weeksNewestFirst[weeksNewestFirst.length - 1].weekNumber}–${weeksNewestFirst[0].weekNumber})`}
          </button>
        )}
      </div>
    </section>
  );
}

