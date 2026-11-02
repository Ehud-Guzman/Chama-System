import { money } from '../../utils/format';
import Loader from '../../components/shared/Loader';
import ContributionChart from '../../components/reports/ContributionChart';
import { MonthFunds, monthLabel } from './shared';

export default function MonthlyTab({ monthTotals, months }) {
  return (
    <section>
      {!months ? (
        <Loader />
      ) : months.length === 0 ? (
        <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
          No contributions logged yet.
        </p>
      ) : (
        <>
          {/* The headline the office reads first: what the members themselves
              put in across every month, kept apart from the group funds that
              came in alongside them. */}
          {monthTotals && (
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                  Member contributions
                </p>
                <p className="amount mt-0.5 truncate text-lg font-bold text-primary">
                  {money(monthTotals.personal)}
                </p>
                <p className="text-[11px] text-muted">
                  (what the members themselves paid in, all months)
                </p>
              </div>

              <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                  Group funds
                </p>
                <p className="amount mt-0.5 truncate text-lg font-bold">
                  {money(monthTotals.groupFund)}
                </p>
                <p className="text-[11px] text-muted">(tea and the group's other funds)</p>
              </div>

              <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                  Everything
                </p>
                <p className="amount mt-0.5 truncate text-lg font-bold">
                  {money(monthTotals.all)}
                </p>
                <p className="amount text-[11px] text-muted">
                  (members and funds together, {monthTotals.count} entries)
                </p>
              </div>

              <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                  Members paying
                </p>
                <p className="amount mt-0.5 text-lg font-bold">
                  {monthTotals.contributingMembers}
                </p>
                <p className="text-[11px] text-muted">(paid in at least once, any month)</p>
              </div>
            </div>
          )}

        {/* The same months as a chart: a month that came in short should be
            visible at a glance, not something you find by reading twelve rows
            of figures. */}
        <div className="mb-3 rounded-xl border border-rule bg-surface px-3 py-3">
          <ContributionChart
            points={[...months].reverse().map((m) => ({
              label: monthLabel(m.month),
              personal: m.personalTotal,
              groupFund: m.groupFundTotal,
              other: 0,
              total: m.total,
            }))}
            seriesLabel="Members"
            emptyMessage="No month has anything logged against it yet."
          />
        </div>

        <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
          {months.map((m) => (
            <li
              key={m.month}
              className="border-b border-rule px-4 py-3 last:border-b-0"
            >
              <div className="md:grid md:grid-cols-2 md:items-start md:gap-6">
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="amount text-sm font-semibold">{m.month}</p>
                    <p className="amount text-sm font-semibold text-primary">
                      {money(m.total)}
                    </p>
                  </div>
                  <p className="amount mt-0.5 text-xs text-muted">
                    ({money(m.personalTotal)} from members ·{" "}
                    {money(m.groupFundTotal)} from funds · {m.memberCount}{" "}
                    {m.memberCount === 1 ? "member" : "members"} paid in)
                  </p>
                  {/* On a phone the month list has to stay a list, so the
                      funds stay behind this tap. A wide screen has the room
                      for them outright — see the column beside it. */}
                  <details className="mt-1 md:hidden">
                    <summary className="cursor-pointer text-xs font-medium text-primary">
                      By type
                    </summary>
                    <div className="mt-1">
                      <MonthFunds byType={m.byType} />
                    </div>
                  </details>
                </div>

                {/* The funds filled in, in what used to be the empty half of
                    the row: the same list, on the screen that had the space
                    for it, without a click. */}
                <div className="mt-2 hidden md:mt-0 md:block">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                    By type
                  </p>
                  <div className="mt-1">
                    <MonthFunds byType={m.byType} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  );
}
