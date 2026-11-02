import { useCallback, useEffect, useState } from "react";
import api, { apiMessage } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/shared/Toast";
import Loader from "../components/shared/Loader";
import ErrorState from "../components/shared/ErrorState";
import MemberChartModal from "../components/reports/MemberChartModal";
import PrintReportPanel from "../components/reports/PrintReportPanel";
import SummaryTab from './reports/SummaryTab';
import FinesTab from './reports/FinesTab';
import PerformanceTab from './reports/PerformanceTab';
import MonthlyTab from './reports/MonthlyTab';
import WeeklyTab from './reports/WeeklyTab';

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
  const { user } = useAuth();
  // Whether this role may work a fine (issue, settle, void) rather than only read the
  // report — the same two roles the route guard and the API allow.
  const mayWorkFines = ['super_admin', 'admin'].includes(user?.role);
  const [tab, setTab] = useState("summary"); // summary | weekly | performance | monthly | fines | print
  const [summary, setSummary] = useState(null);
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

  const loadSummary = useCallback(() => {
    setLoading(true);
    setLoadError('');
    // One request, and one figure set. The summary used to be read alongside
    // /api/reports/trend so a twelve-week bar chart could sit above the figures; that chart has
    // gone (its bars were one unvarying height a week, so it informed nobody and cost a round
    // trip on the slowest connection in the app), and the summary is what the screen is for.
    return api
      .get("/api/reports/summary")
      .then((summaryRes) => {
        setSummary(summaryRes.data);
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
                    : tab === "print"
                      ? "Print a report"
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
          ["print", "Print a report"],
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
        <SummaryTab summary={summary} />
      )}

      {tab === "print" && (
        <PrintReportPanel role={user?.role} weekNumber={summary?.thisWeek?.weekNumber} />
      )}

      {tab === "fines" && (
        <FinesTab fines={fines} mayWorkFines={mayWorkFines} />
      )}

      {tab === "performance" && (
        <PerformanceTab
          performance={performance}
          performanceTotals={performanceTotals}
          setChartMember={setChartMember}
        />
      )}

      {tab === "monthly" && (
        <MonthlyTab monthTotals={monthTotals} months={months} />
      )}

      {tab === "weekly" && (
        <WeeklyTab
          backupHealth={backupHealth}
          openWeek={openWeek}
          setOpenWeek={setOpenWeek}
          weeks={weeks}
        />
      )}
      {/* One member's own chart — opened from his row in the performance list,
          either shape of it. */}
      {chartMember && (
        <MemberChartModal member={chartMember} onClose={() => setChartMember(null)} />
      )}
    </div>
  );
}
