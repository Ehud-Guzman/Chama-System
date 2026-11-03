import { money } from '../../utils/format';
import Loader from '../../components/shared/Loader';
import MemberPerformanceList from '../../components/reports/MemberPerformanceList';

export default function PerformanceTab({ performance, performanceTotals, setChartMember }) {
  return (
    <section>
      {!performance ? (
        <Loader />
      ) : performance.length === 0 ? (
        <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
          No active members yet.
        </p>
      ) : (
        /* Cards on a phone, the table from md up — and every row opens that
           member's own chart. */
        <MemberPerformanceList members={performance} onOpenChart={setChartMember} />
      )}

      {/* The group's own headings, above the ranking: what the members have paid
          between them, how consistent they are on average, and what is still
          owed. The list below answers "who"; this answers "how are we doing". */}
      {performanceTotals && performance.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Brought forward + paid in
            </p>
            <p className="amount mt-0.5 truncate text-lg font-bold text-primary">
              {money(performanceTotals.totalContributed)}
            </p>
            <p className="amount text-[11px] text-muted">
              (incl. {money(performanceTotals.carriedIn)} carried in)
            </p>
          </div>

          <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Average consistency
            </p>
            <p className="amount mt-0.5 text-lg font-bold">
              {performanceTotals.averageConsistency === null
                ? "—"
                : `${performanceTotals.averageConsistency}%`}
            </p>
            <p className="amount text-[11px] text-muted">
              ({performanceTotals.weeksPaid} of {performanceTotals.weeksExpected} weeks paid in
              full)
            </p>
          </div>

          <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Keeping up
            </p>
            <p className="amount mt-0.5 text-lg font-bold text-accent">
              {performanceTotals.fullyPaidMembers}
            </p>
            <p className="amount text-[11px] text-muted">
              (of {performanceTotals.members} members paying every closed week ·{" "}
              {performanceTotals.membersBehind} behind)
            </p>
          </div>

          <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Fines owed
            </p>
            <p
              className={`amount mt-0.5 truncate text-lg font-bold ${
                performanceTotals.pendingFines > 0 ? "text-alert" : ""
              }`}
            >
              {money(performanceTotals.pendingFines)}
            </p>
            <p className="text-[11px] text-muted">(owed by the members listed below)</p>
          </div>
        </div>
      )}

      <p className="mt-2 text-xs text-muted">
        Consistency = weeks paid in full ÷ weeks expected, personal weekly
        contribution types only (group funds like Chai aren&apos;t counted as
        individual effort). Tap a member to open their contribution chart.
      </p>
      {/* "Weeks expected" counts only weeks that have CLOSED, so between the day the cycle
          opened and the first Thursday after it this report reads 0/0 for everybody with a
          consistency of "—" — which looks like a fault and is not one. Said here, once, rather
          than left for somebody to conclude the report is broken. */}
      {performance?.length > 0 && performance.every((m) => m.weeksExpected === 0) && (
        <p className="mt-2 rounded-xl border border-rule bg-surface px-4 py-3 text-xs leading-5 text-muted">
          <strong className="font-semibold text-ink">No week has closed yet.</strong> The
          consistency figures here count only weeks that have finished and been scored — the
          opening week is the baseline (each member&apos;s money for it is already inside the
          balance he carried in) and the week running now is not scored until its Thursday has
          passed, because until then nobody has been asked for it. So the ratio reads 0/0 for
          every member until the day after the first collection; the
          {performance[0].runningWeek != null
            ? ` “Week ${performance[0].runningWeek} (running)”`
            : ' “This week”'}{' '}
          figures below show what has come in so far, and the weeks that have closed will
          appear here from the Friday after that Thursday.
        </p>
      )}
    </section>
  );
}
