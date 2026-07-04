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
export default function WeeklyScheduleTable({ schedules }) {
  if (!schedules || schedules.length === 0) return null;

  return (
    <div className="space-y-4">
      {schedules.map((s) => (
        <section key={s.typeId} className="overflow-hidden rounded-xl border border-rule bg-surface">
          <header className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-3">
            <p className="text-sm font-semibold">{s.typeName}</p>
            <p className="amount text-xs text-muted">{money(s.weeklyAmount)} / week</p>
          </header>
          <div className="max-h-72 overflow-y-auto">
            <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
              <span>Wk</span>
              <span>Dates</span>
              <span className="text-right">Paid</span>
              <span className="text-right">Status</span>
            </div>
            <ul>
              {s.weeks.map((w) => (
                <li
                  key={w.weekNumber}
                  className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 border-t border-rule px-4 py-2 text-sm"
                >
                  <span className="amount text-xs text-muted">{w.weekNumber}</span>
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
      ))}
    </div>
  );
}
