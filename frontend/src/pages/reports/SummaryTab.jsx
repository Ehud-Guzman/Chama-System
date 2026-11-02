import { money, METHOD_LABELS } from '../../utils/format';
import WeekProgressCard from '../../components/reports/WeekProgressCard';

export default function SummaryTab({ summary }) {
  return (
    <>
      {/* =====================================================
          THIS WEEK, AND WHO IS STILL TO PAY.
          It replaced a twelve-week trend chart whose bars were all the same height — every
          active member pays the same weekly amount, so it could not show the one thing worth
          knowing. This shows the week the group is actually in: what it asked for, what has
          come in, how many members are still to bring theirs, and the gap. It changes as the
          money comes in — 0% on a Friday morning, full by Thursday night — so it is worth
          looking at, and it answers "what do I need to chase today?" without a click.
      ====================================================== */}
      {summary?.thisWeek && (
        <div className="mt-5">
          <WeekProgressCard week={summary.thisWeek} />
        </div>
      )}

      {/* The figures width-wise: this was a two-column grid while the audit trail
          sat in the second column. The trail has its own screen now, so the
          summary takes the whole width rather than leaving half of it empty. */}
      <div className="mt-5">
      {summary && (
        <section className="rounded-xl border border-rule bg-surface p-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Total contributed (all time)
          </p>
          <p className="amount mt-1 text-3xl font-bold text-primary">
            {money(summary.totalContributed)}
          </p>
          {/* What the headline is made of, named the way the ledger header
              names its own parts. All-time has to include the money the
              members and the funds already held when the books opened: no
              contribution row can show it, so a total built from rows alone
              reads as if the group had never collected anything. */}
          <p className="amount mt-1 text-sm text-muted">
            ({money(summary.carriedIn)} carried in from the paper ledger +{" "}
            {money(summary.collected)} paid in since)
          </p>
          <p className="amount mt-1 text-sm text-muted">
            {money(summary.thisWeekTotal)} paid in this week
          </p>

          {summary.totalExpenses > 0 && (
            <p className="amount mt-1 text-sm text-alert">
              − {money(summary.totalExpenses)} spent out of the funds
            </p>
          )}
          <p className="amount mt-1 text-lg font-semibold">
            {money(summary.netBalance)}{" "}
            <span className="text-xs font-normal text-muted">
              held by the group now (everything in, less everything spent)
            </span>
          </p>

          {summary.finesCollected > 0 && (
            <p className="amount mt-1 text-xs text-muted">
              + {money(summary.finesCollected)} collected from fines (not
              counted above — fines aren't a contribution type)
            </p>
          )}

          <p className="mt-4 border-t border-rule pt-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
            By method (since the books opened)
          </p>
          <ul>
            {summary.byMethod.map((m) => (
              <li
                key={m.method}
                className="flex flex-col sm:flex-row sm:items-baseline justify-between border-b border-rule py-2 last:border-b-0 gap-1 sm:gap-2"
              >
                <span className="text-sm">
                  {METHOD_LABELS[m.method] || m.method}
                </span>
                <span className="amount text-xs text-muted">
                  ×{m.count}
                </span>
                <span className="amount text-sm font-semibold ml-auto">
                  {money(m.total)}
                </span>
              </li>
            ))}
          </ul>

          {summary.byType?.length > 0 && (
            <>
              <p className="mt-4 border-t border-rule pt-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
                By type (since the books opened)
              </p>
              <ul>
                {summary.byType.map((t) => (
                  <li
                    key={t.typeId}
                    className="flex flex-col sm:flex-row sm:items-baseline justify-between border-b border-rule py-2 last:border-b-0 gap-1 sm:gap-2"
                  >
                    <span className="text-sm">
                      {t.name}
                    </span>
                    <span className="amount text-xs text-muted">
                      ×{t.count}
                    </span>
                    <span className="amount text-sm font-semibold ml-auto">
                      {money(t.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-3 text-sm text-muted">
            <span className="amount font-semibold text-ink">
              {summary.membersWithZeroContributions}
            </span>{" "}
            of {summary.activeMembers} active members are yet to contribute.
          </p>
        </section>
      )}

      </div>

    {/* The fines position and what each fund holds, under the totals they belong
        to: a committee reads "what came in" and then immediately asks what is
        still owed and what is left in the funds. */}
    {summary?.fines && (
      <section className="mt-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
          Fines
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Still owed
            </p>
            <p
              className={`amount mt-0.5 truncate text-lg font-bold ${
                summary.fines.outstanding > 0 ? "text-alert" : ""
              }`}
            >
              {money(summary.fines.outstanding)}
            </p>
            <p className="amount text-[11px] text-muted">
              ({summary.fines.pendingCount} of {summary.fines.count} fines not cleared)
            </p>
          </div>

          <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Issued
            </p>
            <p className="amount mt-0.5 truncate text-lg font-bold">
              {money(summary.fines.issued)}
            </p>
            <p className="amount text-[11px] text-muted">
              ({summary.fines.count} fines raised in total)
            </p>
          </div>

          <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Paid off
            </p>
            <p className="amount mt-0.5 truncate text-lg font-bold text-accent">
              {money(summary.fines.cleared)}
            </p>
            <p className="amount text-[11px] text-muted">
              ({summary.fines.clearedCount} fines cleared)
            </p>
          </div>

          <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Cash from fines
            </p>
            <p className="amount mt-0.5 truncate text-lg font-bold">
              {money(summary.fines.collected)}
            </p>
            <p className="text-[11px] text-muted">(kept out of contributions)</p>
          </div>
        </div>

        {summary.fines.byType?.length > 0 && (
          <ul className="mt-2 divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
            {summary.fines.byType.map((t) => (
              <li key={t.name} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate text-sm">
                  {t.name}
                  <span className="ml-1 text-[11px] uppercase tracking-wide text-muted">
                    {t.category}
                  </span>
                </span>
                <span className="amount shrink-0 text-right text-sm font-semibold">
                  {t.issued > 0 ? money(t.issued) : "—"}
                  {t.remaining > 0 && (
                    <span className="block text-[11px] font-normal text-alert">
                      {money(t.remaining)} owed
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    )}

    {summary?.funds?.length > 0 && (
      <section className="mt-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
            What each fund holds
          </h2>
          {/* The funds added up, with the spending already off them — the figure
              somebody means by "the group's fund" when they ask it in a meeting,
              and the same one the spending screen quotes. */}
          {summary.groupFund && (
            <p className="amount text-sm font-semibold">
              {money(summary.groupFund.holds)}{" "}
              <span className="text-xs font-normal text-muted">
                all funds together ({money(summary.groupFund.in)} in −{" "}
                {money(summary.groupFund.spent)} spent
                {summary.groupFund.onLoan > 0
                  ? ` − ${money(summary.groupFund.onLoan)} out on loan`
                  : ""}
                )
              </span>
            </p>
          )}
        </div>
        <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
          {summary.funds.map((fund) => (
            <li key={fund.name} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{fund.name}</span>
                <span className="amount shrink-0 text-sm font-semibold">
                  {money(fund.balance)}
                </span>
              </div>
              <p className="amount mt-0.5 text-[11px] text-muted">
                ({money(fund.carriedIn)} carried in + {money(fund.collected)} paid in
                {fund.derived > 0 ? ` + ${money(fund.derived)} automatic tea` : ""}
                {fund.spent > 0 ? ` − ${money(fund.spent)} spent` : ""})
              </p>
            </li>
          ))}
        </ul>
      </section>
    )}
    </>
  );
}
