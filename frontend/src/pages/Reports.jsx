import { useCallback, useEffect, useState } from "react";
import api, { apiMessage } from "../services/api";
import { useToast } from "../components/shared/Toast";
import {
  money,
  shortDate,
  shortDateTime,
  METHOD_LABELS,
} from "../utils/format";
import Loader from "../components/shared/Loader";
import MemberPerformanceList from "../components/reports/MemberPerformanceList";
import MemberChartModal from "../components/reports/MemberChartModal";
import ContributionChart from "../components/reports/ContributionChart";

const ACTION_LABELS = {
  create: "Created",
  update: "Edited",
  delete: "Deleted",
  reset: "Reset",
};

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

export default function Reports() {
  const toast = useToast();
  const [tab, setTab] = useState("summary"); // summary | weekly | performance | monthly | fines
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState(null);
  const [audit, setAudit] = useState({ entries: [], page: 1, pages: 1 });
  const [performance, setPerformance] = useState(null);
  const [performanceTotals, setPerformanceTotals] = useState(null);
  const [months, setMonths] = useState(null);
  const [monthTotals, setMonthTotals] = useState(null);
  const [weeks, setWeeks] = useState(null);
  const [openWeek, setOpenWeek] = useState(null);
  const [fines, setFines] = useState(null);
  // The member whose chart is open. Held as the row the table gave us, so the
  // sheet can name him before its own figures arrive.
  const [chartMember, setChartMember] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAudit = useCallback(async (page = 1) => {
    try {
      const res = await api.get("/api/reports/audit-log", { params: { page } });
      setAudit(res.data);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    // The summary and the year's trend are read together: the chart is the first
    // thing on the summary screen, and a summary that arrived without it would
    // leave a hole where the trend belongs.
    Promise.all([
      api.get("/api/reports/summary"),
      api.get("/api/reports/trend", { params: { weeks: 12 } }),
      loadAudit(1),
    ])
      .then(([summaryRes, trendRes]) => {
        setSummary(summaryRes.data);
        setTrend(trendRes.data.weeks || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loadAudit]);

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
        .then((res) => setWeeks(res.data.weeks))
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
          {/* The trend first: twelve weeks of what the members actually paid, so the
              headline figures below have a shape behind them rather than being four
              numbers with no history. */}
          {trend && (
            <section className="rounded-xl border border-rule bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Member contributions — last {trend.length} weeks
                </h2>
                <p className="amount text-xs text-muted">
                  {money(trend.reduce((sum, w) => sum + w.memberTotal, 0))} over the period
                </p>
              </div>

              <div className="mt-3">
                <ContributionChart
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

              <p className="mt-2 text-[11px] leading-5 text-muted">
                Each bar is a week of the cycle: the dark part is what the members paid in,
                the pale part the funds collected alongside them. Weeks that closed with
                somebody still short are named week by week in the weekly reconciliation.
              </p>
            </section>
          )}

          <div className="mt-5 md:grid md:grid-cols-2 md:items-start md:gap-6">
          {summary && (
            <section className="rounded-xl border border-rule bg-surface p-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
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
                {money(summary.carriedIn)} brought forward from the paper ledger +{" "}
                {money(summary.collected)} collected since
              </p>
              <p className="amount mt-1 text-sm text-muted">
                {money(summary.thisWeekTotal)} this week
              </p>

              {summary.totalExpenses > 0 && (
                <p className="amount mt-1 text-sm text-alert">
                  − {money(summary.totalExpenses)} spent from tracked funds
                </p>
              )}
              <p className="amount mt-1 text-lg font-semibold">
                {money(summary.netBalance)}{" "}
                <span className="text-xs font-normal text-muted">
                  net balance
                </span>
              </p>

              {summary.finesCollected > 0 && (
                <p className="amount mt-1 text-xs text-muted">
                  + {money(summary.finesCollected)} collected from fines (not
                  counted above — fines aren't a contribution type)
                </p>
              )}

              <p className="mt-4 border-t border-rule pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
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
                  <p className="mt-4 border-t border-rule pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
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

          <section className="mt-5 md:mt-0">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
              Audit trail
            </h2>
            {audit.entries.length === 0 ? (
              <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
                No activity recorded yet.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
                {audit.entries.map((e) => (
                  <li
                    key={e._id}
                    className="border-b border-rule px-4 py-3 last:border-b-0"
                  >
                    <p className="text-sm">
                      <span className="font-semibold">
                        {e.performedBy?.name || "Unknown"}
                      </span>{" "}
                      <span className="text-muted">
                        {(ACTION_LABELS[e.action] || e.action).toLowerCase()} a{" "}
                        {e.entityType.toLowerCase()}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {shortDateTime(e.createdAt)}
                      {e.entityType === "Contribution" &&
                        (e.after || e.before) && (
                          <span className="amount">
                            {" "}
                            · {money((e.after || e.before).amount)}
                          </span>
                        )}
                      {e.entityType === "Member" && (e.after || e.before) && (
                        <span> · {(e.after || e.before).name}</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {audit.pages > 1 && (
              <nav
                className="mt-3 flex items-center justify-between"
                aria-label="Audit pages"
              >
                <button
                  type="button"
                  onClick={() => loadAudit(Math.max(1, audit.page - 1))}
                  disabled={audit.page === 1}
                  className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="amount text-xs text-muted">
                  Page {audit.page} of {audit.pages}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    loadAudit(Math.min(audit.pages, audit.page + 1))
                  }
                  disabled={audit.page === audit.pages}
                  className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary disabled:opacity-40"
                >
                  Next
                </button>
              </nav>
            )}
          </section>
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
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
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
                  {summary.fines.pendingCount} of {summary.fines.count} not cleared
                </p>
              </div>

              <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Issued
                </p>
                <p className="amount mt-0.5 truncate text-lg font-bold">
                  {money(summary.fines.issued)}
                </p>
                <p className="amount text-[11px] text-muted">{summary.fines.count} fines</p>
              </div>

              <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Paid off
                </p>
                <p className="amount mt-0.5 truncate text-lg font-bold text-accent">
                  {money(summary.fines.cleared)}
                </p>
                <p className="amount text-[11px] text-muted">
                  {summary.fines.clearedCount} cleared
                </p>
              </div>

              <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Cash from fines
                </p>
                <p className="amount mt-0.5 truncate text-lg font-bold">
                  {money(summary.fines.collected)}
                </p>
                <p className="text-[11px] text-muted">kept out of contributions</p>
              </div>
            </div>

            {summary.fines.byType?.length > 0 && (
              <ul className="mt-2 divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
                {summary.fines.byType.map((t) => (
                  <li key={t.name} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 truncate text-sm">
                      {t.name}
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted">
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
                    {money(fund.carriedIn)} carried in + {money(fund.collected)} collected
                    {fund.derived > 0 ? ` + ${money(fund.derived)} automatic tea` : ""}
                    {fund.spent > 0 ? ` − ${money(fund.spent)} spent` : ""}
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
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
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
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                    Issued in total
                  </p>
                  <p className="amount mt-0.5 truncate text-lg font-bold">
                    {money(fines.totals.issued)}
                  </p>
                  <p className="amount text-[11px] text-muted">{fines.totals.count} fines</p>
                </div>

                <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
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
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
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
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-muted">
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
                  {fines.byMember.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-rule px-5 py-6 text-center text-sm text-muted">
                      Nobody owes a fine — every one issued has been cleared.
                    </p>
                  ) : (
                    <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
                      {fines.byMember.map((row) => (
                        <li
                          key={row.memberId}
                          className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm">
                              {row.name}
                              {!row.active && (
                                <span className="ml-1 text-[10px] uppercase tracking-wide text-muted">
                                  resigned
                                </span>
                              )}
                            </span>
                            <span className="amount block text-[11px] text-muted">
                              {row.regNumber || row.phone} · {row.fines}{" "}
                              {row.fines === 1 ? "fine" : "fines"}
                            </span>
                          </span>
                          <span className="amount shrink-0 text-sm font-semibold text-alert">
                            {money(row.outstanding)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
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
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Paid between them
                </p>
                <p className="amount mt-0.5 truncate text-lg font-bold text-primary">
                  {money(performanceTotals.totalContributed)}
                </p>
                <p className="amount text-[11px] text-muted">
                  incl. {money(performanceTotals.carriedIn)} carried forward
                </p>
              </div>

              <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Average consistency
                </p>
                <p className="amount mt-0.5 text-lg font-bold">
                  {performanceTotals.averageConsistency === null
                    ? "—"
                    : `${performanceTotals.averageConsistency}%`}
                </p>
                <p className="amount text-[11px] text-muted">
                  {performanceTotals.weeksPaid} of {performanceTotals.weeksExpected} weeks paid
                </p>
              </div>

              <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Keeping up
                </p>
                <p className="amount mt-0.5 text-lg font-bold text-accent">
                  {performanceTotals.fullyPaidMembers}
                </p>
                <p className="amount text-[11px] text-muted">
                  of {performanceTotals.members} at 100% · {performanceTotals.membersBehind} below
                  80%
                </p>
              </div>

              <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Fines owed
                </p>
                <p
                  className={`amount mt-0.5 truncate text-lg font-bold ${
                    performanceTotals.pendingFines > 0 ? "text-alert" : ""
                  }`}
                >
                  {money(performanceTotals.pendingFines)}
                </p>
                <p className="text-[11px] text-muted">across everyone below</p>
              </div>
            </div>
          )}

          <p className="mt-2 text-xs text-muted">
            Consistency = weeks paid in full ÷ weeks expected since joining,
            personal weekly contribution types only (group funds like Chai
            aren't counted as individual effort). Tap a member to open their
            contribution chart.
          </p>
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
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                      Member contributions
                    </p>
                    <p className="amount mt-0.5 truncate text-lg font-bold text-primary">
                      {money(monthTotals.personal)}
                    </p>
                    <p className="text-[11px] text-muted">all months</p>
                  </div>

                  <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                      Group funds
                    </p>
                    <p className="amount mt-0.5 truncate text-lg font-bold">
                      {money(monthTotals.groupFund)}
                    </p>
                    <p className="text-[11px] text-muted">tea and other funds</p>
                  </div>

                  <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                      Everything
                    </p>
                    <p className="amount mt-0.5 truncate text-lg font-bold">
                      {money(monthTotals.all)}
                    </p>
                    <p className="amount text-[11px] text-muted">
                      {monthTotals.count} rows logged
                    </p>
                  </div>

                  <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                      Members paying
                    </p>
                    <p className="amount mt-0.5 text-lg font-bold">
                      {monthTotals.contributingMembers}
                    </p>
                    <p className="text-[11px] text-muted">at least once</p>
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
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="amount text-sm font-semibold">{m.month}</p>
                    <p className="amount text-sm font-semibold text-primary">
                      {money(m.total)}
                    </p>
                  </div>
                  <p className="amount mt-0.5 text-xs text-muted">
                    {money(m.personalTotal)} personal ·{" "}
                    {money(m.groupFundTotal)} group funds ·{" "}
                    {m.memberCount} {m.memberCount === 1 ? "member" : "members"}
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-medium text-primary">
                      By type
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {m.byType.map((t) => (
                        <li
                          key={t.name}
                          className="flex justify-between text-xs text-muted"
                        >
                          <span>{t.name}</span>
                          <span className="amount">{money(t.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
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
                <span className="font-semibold text-alert">short</span> when one
                or more eligible members still owe their weekly minimum. Tap a
                week to see exactly who.
              </p>
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
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                            Now
                          </span>
                        )}
                        {w.isBaseline && (
                          <span className="rounded bg-canvas px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
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
                          Members {money(w.memberTotal)}
                          {!w.isBaseline && w.memberEligibleCount > 0 && (
                            <span>
                              {" "}
                              · {w.memberPaidCount}/{w.memberEligibleCount} paid in full
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span
                          className={`text-xs font-semibold ${w.balanced ? "text-accent" : "text-alert"}`}
                        >
                          {w.isBaseline
                            ? "Nothing due"
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
                                    <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-muted">
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
                              {t.shortfallMembers.length > 0 ? (
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
                                        {money(m.paid)} · {m.status}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
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
