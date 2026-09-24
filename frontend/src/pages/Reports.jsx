import { useCallback, useEffect, useState } from "react";
import api, { apiMessage } from "../services/api";
import { useToast } from "../components/shared/Toast";
import {
  money,
  shortDate,
  METHOD_LABELS,
} from "../utils/format";
import Loader from "../components/shared/Loader";
import ErrorState from "../components/shared/ErrorState";
import MemberPerformanceList from "../components/reports/MemberPerformanceList";
import MemberChartModal from "../components/reports/MemberChartModal";
import ContributionChart from "../components/reports/ContributionChart";
import WhoOwesWhat from "../components/fines/WhoOwesWhat";

// Month keys arrive as 'YYYY-MM' (the group's own calendar month). A fixed list
// rather than a locale call: the same label on every device, in any language.
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(key) {
  const [year, month] = String(key).split("-");
  return `${MONTH_SHORT[Number(month) - 1]} ${year.slice(2)}`;
}

async function downloadFile(url, filename, toast) {
  try {
    const res = await api.get(url, { responseType: "blob" });
    const objectUrl = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    toast(apiMessage(err, "Export failed"), "error");
  }
}

// One month's funds, biggest first. Rendered twice on purpose: beside the
// month's own figures on a wide screen — where the row's middle was empty space
// doing nothing — and behind a tap on a phone, where a line per fund for every
// month would bury the month list it belongs to.
function MonthFunds({ byType }) {
  return (
    <ul className="space-y-0.5">
      {byType.map((t) => (
        <li
          key={t.name}
          className="flex items-baseline justify-between gap-3 text-xs text-muted"
        >
          <span className="min-w-0 truncate">{t.name}</span>
          <span className="amount shrink-0">{money(t.total)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Reports() {
  const toast = useToast();
  const [tab, setTab] = useState("summary"); // summary | weekly | performance | monthly | fines
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [performanceTotals, setPerformanceTotals] = useState(null);
  const [months, setMonths] = useState(null);
  const [monthTotals, setMonthTotals] = useState(null);
  const [weeks, setWeeks] = useState(null);
  // How old the last copy of the books taken off this machine is, alongside the week's figures.
  // The backend decides whether it is worth saying; null means there is nothing to say.
  const [backupHealth, setBackupHealth] = useState(null);
  const [openWeek, setOpenWeek] = useState(null);
  const [fines, setFines] = useState(null);
  // The member whose chart is open. Held as the row the table gave us, so the
  // sheet can name him before its own figures arrive.
  const [chartMember, setChartMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // The trend opens folded to a strip. It is context for the figures beneath it
  // rather than the subject of the screen, and at full height it pushed the four
  // numbers the office actually reads off the summary below the fold on a phone.
  const [chartOpen, setChartOpen] = useState(false);

  const loadSummary = useCallback(() => {
    setLoading(true);
    setLoadError('');
    // The summary and the year's trend are read together: the chart is the first
    // thing on the summary screen, and a summary that arrived without it would
    // leave a hole where the trend belongs.
    return Promise.all([api.get("/api/reports/summary"), api.get("/api/reports/trend", { params: { weeks: 12 } })])
      .then(([summaryRes, trendRes]) => {
        setSummary(summaryRes.data);
        setTrend(trendRes.data.weeks || []);
      })
      .catch((err) => {
        // A dropped connection on a phone is the common case here, not an empty
        // report: say so, and offer the one action that helps.
        setLoadError(apiMessage(err, "Could not load the reports"));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (tab === "performance" && !performance) {
      api
        .get("/api/reports/performance")
        .then((res) => {
          setPerformance(res.data.members);
          setPerformanceTotals(res.data.totals || null);
        })
        .catch(() => {});
    }
    if (tab === "monthly" && !months) {
      api
        .get("/api/reports/monthly")
        .then((res) => {
          setMonths(res.data.months);
          setMonthTotals(res.data.totals || null);
        })
        .catch(() => {});
    }
    if (tab === "weekly" && !weeks) {
      api
        .get("/api/reports/weekly")
        .then((res) => {
          setWeeks(res.data.weeks);
          setBackupHealth(res.data.backup || null);
        })
        .catch(() => {});
    }
    if (tab === "fines" && !fines) {
      api
        .get("/api/reports/fines")
        .then((res) => setFines(res.data))
        .catch(() => {});
    }
  }, [tab, performance, months, weeks, fines]);

  if (loading) return <Loader />;
  if (loadError) {
    return (
      <ErrorState
        title="Could not load the reports"
        message={loadError}
        onRetry={loadSummary}
      />
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">
            Reports
          </p>
          <h1 className="mt-1 text-2xl font-bold">
            {tab === "summary"
              ? "Summary"
              : tab === "performance"
                ? "Member performance"
                : tab === "monthly"
                  ? "Monthly totals"
                  : tab === "fines"
                    ? "Fines"
                    : "Weekly reconciliation"}
          </h1>
        </div>
        <div className="flex gap-2">
          {tab === "summary" && (
            <button
              type="button"
              onClick={() =>
                downloadFile("/api/reports/export", "contributions.xlsx", toast)
              }
              className="min-h-12 rounded-xl border border-rule bg-surface px-4 text-sm font-semibold"
            >
              Export Excel
            </button>
          )}
          {tab === "fines" && (
            <button
              type="button"
              onClick={() =>
                downloadFile("/api/reports/fines/export", "fines-report.xlsx", toast)
              }
              className="min-h-12 rounded-xl border border-rule bg-surface px-4 text-sm font-semibold"
            >
              Export Excel
            </button>
          )}
          {tab === "performance" && (
            <button
              type="button"
              onClick={() =>
                downloadFile(
                  "/api/reports/performance/export",
                  "member-performance.xlsx",
                  toast,
                )
              }
              className="min-h-12 rounded-xl border border-rule bg-surface px-4 text-sm font-semibold"
            >
              Export Excel
            </button>
          )}
          {tab === "monthly" && (
            <button
              type="button"
              onClick={() =>
                downloadFile(
                  "/api/reports/monthly/export",
                  "monthly-totals.xlsx",
                  toast,
                )
              }
              className="min-h-12 rounded-xl border border-rule bg-surface px-4 text-sm font-semibold"
            >
              Export Excel
            </button>
          )}
          {tab === "weekly" && (
            <button
              type="button"
              onClick={() =>
                downloadFile(
                  "/api/reports/weekly/export",
                  "weekly-reconciliation.xlsx",
                  toast,
                )
              }
              className="min-h-12 rounded-xl border border-rule bg-surface px-4 text-sm font-semibold"
            >
              Export Excel
            </button>
          )}
        </div>
      </header>

      {/* Tabs wrap rather than scroll: five labels never fit one 360px row, and a
          tab you have to scroll to find is a tab nobody finds. */}
      <div className="flex flex-wrap gap-2">
        {[
          ["summary", "Summary"],
          ["weekly", "Weekly reconciliation"],
          ["performance", "Member performance"],
          ["monthly", "Monthly totals"],
          ["fines", "Fines"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${
              tab === value
                ? "border-primary bg-primary/10 text-primary"
                : "border-rule text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" && (
        <>
          {/* The trend, folded small. Twelve weeks of what the members actually
              paid, so the headline figures below have a shape behind them rather
              than being four numbers with no history — but as a strip, not as the
              first screenful. Opening it gives the same bars full height, and the
              note that explains what they are. */}
          {trend && (
            <section className="rounded-xl border border-rule bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
                    Member contributions — last {trend.length} weeks
                  </h2>
                  <p className="amount mt-0.5 text-xs text-muted">
                    {money(trend.reduce((sum, w) => sum + w.memberTotal, 0))} over the period
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setChartOpen((open) => !open)}
                  aria-expanded={chartOpen}
                  className="min-h-9 shrink-0 rounded-lg border border-rule px-3 text-xs font-semibold text-primary"
                >
                  {chartOpen ? "Hide chart" : "Expand chart"}
                </button>
              </div>

              <div className="mt-2">
                <ContributionChart
                  height={chartOpen ? 240 : 88}
                  points={trend.map((w) => ({
                    label: w.label,
                    personal: w.memberTotal,
                    groupFund: w.groupFundTotal,
                    other: 0,
                    total: w.total,
                  }))}
                  seriesLabel="Members"
                  emptyMessage="No week has been collected yet, so there is nothing to chart."
                />
              </div>

              {chartOpen && (
                <p className="mt-2 text-[11px] leading-5 text-muted">
                  Each bar is a week of the cycle: the dark part is what the members paid in,
                  the pale part the funds collected alongside them. Weeks that closed with
                  somebody still short are named week by week in the weekly reconciliation.
                </p>
              )}
            </section>
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
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
              What each fund holds
            </h2>
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
      )}

      {tab === "fines" && (
        <section className="space-y-4">
          {!fines ? (
            <Loader />
          ) : fines.totals.count === 0 ? (
            <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
              No fines have been issued.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                    Still owed
                  </p>
                  <p
                    className={`amount mt-0.5 truncate text-lg font-bold ${
                      fines.totals.outstanding > 0 ? "text-alert" : ""
                    }`}
                  >
                    {money(fines.totals.outstanding)}
                  </p>
                  <p className="amount text-[11px] text-muted">
                    {fines.totals.pendingCount} fines
                  </p>
                </div>

                <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                    Issued in total
                  </p>
                  <p className="amount mt-0.5 truncate text-lg font-bold">
                    {money(fines.totals.issued)}
                  </p>
                  <p className="amount text-[11px] text-muted">{fines.totals.count} fines</p>
                </div>

                <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                    Paid off
                  </p>
                  <p className="amount mt-0.5 truncate text-lg font-bold text-accent">
                    {money(fines.totals.cleared)}
                  </p>
                  <p className="amount text-[11px] text-muted">
                    {fines.totals.clearedCount} cleared
                  </p>
                </div>

                <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                    Share cleared
                  </p>
                  <p className="amount mt-0.5 text-lg font-bold">
                    {Math.round(
                      (fines.totals.cleared / Math.max(fines.totals.issued, 1)) * 100,
                    )}
                    %
                  </p>
                  <p className="text-[11px] text-muted">of everything issued</p>
                </div>
              </div>

              <div>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
                  By fine type
                </h2>
                <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
                  {fines.byType.map((t) => (
                    <li key={t.name} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium">
                          {t.name}
                          <span className="ml-1 text-[11px] uppercase tracking-wide text-muted">
                            {t.category}
                          </span>
                        </span>
                        <span className="amount shrink-0 text-sm font-semibold">
                          {money(t.issued)}
                        </span>
                      </div>
                      <p className="amount mt-0.5 text-[11px] text-muted">
                        {t.count} issued
                        {t.outstanding > 0 ? (
                          <span className="text-alert"> · {money(t.outstanding)} still owed</span>
                        ) : (
                          " · all cleared"
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
                    Who owes what
                  </h2>
                  <WhoOwesWhat
                    members={fines.byMember}
                    totals={fines.totals}
                    truncated={fines.byMemberTruncated}
                    limit={fines.byMemberLimit}
                    note="Tap a member to see what he owes it for. The export carries every one, with the phone numbers."
                  />
                </div>

                <div>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
                    Month by month
                  </h2>
                  <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
                    {fines.byMonth.map((m) => (
                      <li
                        key={m.month}
                        className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                      >
                        <span className="amount text-sm">{m.month}</span>
                        <span className="amount text-right text-sm font-semibold">
                          {money(m.issued)}
                          <span className="block text-[11px] font-normal text-muted">
                            {m.count} issued
                            {m.outstanding > 0 ? ` · ${money(m.outstanding)} owed` : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {tab === "performance" && (
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
                  Paid between them
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
      )}

      {tab === "monthly" && (
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
      )}

      {tab === "weekly" && (
        <section>
          {!weeks ? (
            <Loader />
          ) : weeks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
              No weekly contribution types set up yet.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted">
                Expected vs actual, per week, across every fixed weekly
                contribution type, with the members&rsquo; own contributions named
                on every week. The totals rarely match exactly on their own
                — one member overpaying offsets another falling short — so a
                week is only flagged{" "}
                <span className="font-semibold text-alert">short</span> once it
                has closed and one or more eligible members still owe their
                weekly minimum. The week running now reads{" "}
                <span className="font-semibold">in progress</span> with what has
                come in so far, because nobody can be behind on a collection
                night that has not happened yet. Tap a week to see exactly who.
              </p>
              {/* The week's figures, and one fact about the books that is not a figure: how long
                  ago somebody last took a copy off this machine. The committee reads this screen
                  every week, which makes it the right place for a nag nobody has to remember —
                  and it renders only when the backend says there is something to say, so a group
                  that downloads regularly never sees it. */}
              {backupHealth?.note && (
                <p className="mb-3 rounded-xl border border-alert/40 bg-alert/5 px-4 py-3 text-xs font-medium leading-5 text-alert">
                  <span className="font-semibold">Backup: </span>
                  {backupHealth.note}
                </p>
              )}
              <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
                {weeks.map((w) => (
                  <li
                    key={w.weekNumber}
                    className="border-b border-rule last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenWeek(
                          openWeek === w.weekNumber ? null : w.weekNumber,
                        )
                      }
                      className="flex w-full flex-col gap-1 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="amount text-sm font-semibold">
                          Week {w.weekNumber}
                        </span>
                        {w.isCurrent && (
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                            Now
                          </span>
                        )}
                        {w.isBaseline && (
                          <span className="rounded bg-canvas px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                            Baseline
                          </span>
                        )}
                        <span className="amount text-xs text-muted">
                          {shortDate(w.startDate)} – {shortDate(w.endDate)}
                        </span>

                        {/* What the members themselves paid in this week — the
                            figure the week is judged on, kept apart from the tea
                            every member is charged automatically. */}
                        <span className="amount w-full text-xs text-muted sm:w-auto">
                          Paid in by members {money(w.memberTotal)}
                          {!w.isBaseline && w.memberEligibleCount > 0 && (
                            <span>
                              {" "}
                              ({w.memberPaidCount} of {w.memberEligibleCount} paid in full)
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span
                          className={`text-xs font-semibold ${
                            w.isCurrent
                              ? "text-muted"
                              : w.balanced
                                ? "text-accent"
                                : "text-alert"
                          }`}
                        >
                          {/* The week running now is never "short": its Thursday
                              is still to come. Calling it short on its own
                              Friday made every week read like a failure the
                              moment it opened — what belongs there is what has
                              come in so far, which the figures beside this
                              already state. */}
                          {w.isBaseline
                            ? "Nothing due"
                            : w.isCurrent
                              ? "In progress"
                              : w.balanced
                                ? "All paid"
                                : `${w.shortfallCount} short`}
                        </span>
                        <span className="amount text-sm font-semibold">
                          {money(w.actualTotal)}
                        </span>
                        <span className="amount text-xs text-muted">
                          / {money(w.expectedTotal)}
                        </span>
                      </span>
                    </button>

                    {openWeek === w.weekNumber && (
                      <div className="border-t border-rule bg-canvas/40 px-4 py-3">
                        <div className="space-y-3">
                          {w.types.map((t) => (
                            <div key={t.typeId}>
                              <div className="flex items-baseline justify-between gap-3">
                                <p className="text-sm font-semibold">
                                  {t.typeName}
                                  {t.isGroupFund && (
                                    <span className="ml-1 text-[11px] font-normal uppercase tracking-wide text-muted">
                                      group fund
                                    </span>
                                  )}
                                </p>
                                <p
                                  className={`amount text-sm font-semibold ${
                                    t.diff === 0 ? "text-accent" : "text-alert"
                                  }`}
                                >
                                  {money(t.actual)} / {money(t.expected)}
                                  {t.diff !== 0 && (
                                    <span className="ml-1 text-xs">
                                      ({t.diff > 0 ? "+" : ""}
                                      {money(t.diff)})
                                    </span>
                                  )}
                                </p>
                              </div>
                              {t.untrackedAmount > 0 && (
                                <p className="amount mt-0.5 text-xs text-muted">
                                  + {money(t.untrackedAmount)} logged against
                                  ineligible/system members (e.g. backdated
                                  opening balances)
                                </p>
                              )}
                              {/* Contributors first. This list used to sit at the
                                  bottom of the block, behind a click, under a roster
                                  of everybody who had NOT paid — so the one question
                                  the treasurer is holding the page open to answer
                                  ("did he pay?") took the longest to reach. It is now
                                  the first list, open by default, and still a
                                  <details> so a week where everybody paid can be
                                  folded away. Guarded, because an API deployed before
                                  this field existed simply has no list. */}
                              {t.paidMembers?.length > 0 && (
                                <details className="mt-1" open>
                                  <summary className="cursor-pointer text-xs font-medium text-primary">
                                    Who paid in full ({t.paidMembers.length})
                                  </summary>
                                  <ul className="mt-1 space-y-0.5">
                                    {t.paidMembers.map((m) => (
                                      <li
                                        key={m.memberId}
                                        className="flex items-center justify-between text-xs"
                                      >
                                        <span className="text-muted">
                                          {m.name}
                                          {m.regNumber && (
                                            <span className="amount ml-1 text-muted">
                                              ({m.regNumber})
                                            </span>
                                          )}
                                        </span>
                                        <span className="amount font-medium text-accent">
                                          {money(m.paid)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                              {/* Then who still owes. It needs its own heading now that
                                  it follows the payers: without one it reads as a
                                  continuation of the list above it, which is the
                                  opposite of what it says. */}
                              {t.shortfallMembers.length > 0 ? (
                                <>
                                  <p className="mt-2 text-xs font-medium text-alert">
                                    Still to pay ({t.shortfallMembers.length})
                                  </p>
                                  <ul className="mt-1 space-y-0.5">
                                    {t.shortfallMembers.map((m) => (
                                      <li
                                        key={m.memberId}
                                        className="flex items-center justify-between text-xs"
                                      >
                                        <span className="text-muted">
                                          {m.name}
                                          {m.regNumber && (
                                            <span className="amount ml-1 text-muted">
                                              ({m.regNumber})
                                            </span>
                                          )}
                                        </span>
                                        <span
                                          className={`amount font-medium ${
                                            m.status === "unpaid"
                                              ? "text-alert"
                                              : "text-primary"
                                          }`}
                                        >
                                          {money(m.paid)} ·{" "}
                                          {m.status === "partial" ? "partly paid" : "nothing paid"}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </>
                              ) : t.paidMembers?.length ? null : (
                                // Only when there is nothing else to show: with the
                                // payers listed above it, this sentence said the same
                                // thing twice.
                                <p className="mt-1 text-xs text-muted">
                                  Every eligible member paid in full this week.
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {/* One member's own chart — opened from his row in the performance list,
          either shape of it. */}
      {chartMember && (
        <MemberChartModal member={chartMember} onClose={() => setChartMember(null)} />
      )}
    </div>
  );
}
