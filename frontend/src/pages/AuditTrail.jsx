import { useCallback, useEffect, useMemo, useState } from "react";
import api, { apiMessage } from "../services/api";
import { useToast } from "../components/shared/Toast";
import { blobErrorMessage } from "../utils/blobError";
import { shortDateTime } from "../utils/format";
import BackLink from "../components/shared/BackLink";
import Loader from "../components/shared/Loader";
import ErrorState from "../components/shared/ErrorState";

// The audit trail, on its own screen.
//
// It used to be a panel at the foot of the reports screen, under four cards of
// figures, which is the wrong place for the one screen that answers "who changed
// this?". A treasurer reads the reports; the trail is read when something needs
// explaining, by the person who has to explain it.
//
// Two ideas carry the screen. Everything is cut by category — money, people,
// records, settings — because "who touched the money" and "who changed a document"
// are different questions; and the entries worth a second look arrive flagged,
// which is the only way a trail of four hundred ordinary edits says anything at all.
const ACTION_LABELS = {
  create: "created",
  update: "edited",
  delete: "deleted",
  reset: "reset",
};

const CATEGORY_LABELS = {
  money: "Money",
  people: "People",
  records: "Records",
  settings: "Settings",
};

// "ChamaDocument" → "chama document": the stored entity name is for the database,
// not for a sentence.
function entityLabel(entityType) {
  return String(entityType || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

const EMPTY_FILTERS = {
  category: "",
  action: "",
  entity: "",
  by: "",
  from: "",
  to: "",
  q: "",
};

// One flag on an entry: red when it is the shape of money or access moving, amber
// when it is a note. The words come from the server, which is also what reads the
// snapshots the flags are derived from. Small, because a row carries several.
function FlagChip({ flag }) {
  const serious = flag.severity === "high";
  return (
    <li
      className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-4 ${
        serious ? "bg-alert/10 text-alert" : "bg-accent/10 text-accent"
      }`}
    >
      {flag.label}
    </li>
  );
}

// The pager, in the list card's own header as well as under it. Reading a page and
// then scrolling to the foot to ask for the next one is the whole cost of paging
// through a trail, and it is paid twice when the controls only exist at the bottom.
// Rows per page is here for the same reason: the reader knows whether he is skimming
// or auditing.
function Pager({ page, pages, total, from, to, perPage, onPage, onPerPage }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p className="amount text-xs text-muted">
        {total === 0 ? "Nothing to show" : `Showing ${from}–${to} of ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted">
          <span className="hidden sm:inline">Rows</span>
          <select
            aria-label="Rows per page"
            value={perPage}
            onChange={(e) => onPerPage(Number(e.target.value))}
            className="h-9 rounded-lg border border-rule bg-canvas px-2 text-xs"
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="min-h-9 rounded-lg border border-rule px-3 text-xs font-medium text-primary disabled:opacity-40"
        >
          Previous
        </button>
        <span className="amount shrink-0 text-xs text-muted">
          {page} / {Math.max(1, pages)}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="min-h-9 rounded-lg border border-rule px-3 text-xs font-medium text-primary disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function Tile({ label, value, hint, alert, accent }) {
  return (
    <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p
        className={`amount mt-0.5 text-lg font-bold ${
          alert ? "text-alert" : accent ? "text-accent" : ""
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] leading-4 text-muted">{hint}</p>}
    </div>
  );
}


export default function AuditTrail() {
  const toast = useToast();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [unusual, setUnusual] = useState(false);
  const [perPage, setPerPage] = useState(50);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // One object for the request: filters, the unusual switch, the page and how many
  // rows it holds. Kept in one place so the export sends exactly what the screen is
  // showing.
  const params = useMemo(() => {
    const out = { page, limit: perPage };
    for (const [key, value] of Object.entries(filters)) {
      if (value) out[key] = value;
    }
    if (unusual) out.unusual = 1;
    return out;
  }, [filters, unusual, page, perPage]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await api.get("/api/audit", { params });
      setData(res.data);
    } catch (err) {
      setLoadError(apiMessage(err, "Could not load the audit trail"));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  // Any change of filter goes back to page one: staying on page 7 of a set that now
  // has two pages is how a screen ends up looking empty for no reason.
  const change = (patch) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const toggleCategory = (key) => change({ category: filters.category === key ? "" : key });

  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setUnusual(false);
    setPage(1);
  };

  const filtered =
    Object.values(filters).some(Boolean) || unusual;

  // How many of the folded-away filters are doing something, so the fold can say so
  // rather than hiding an active filter behind a closed summary.
  const moreCount = ["action", "entity", "by", "from", "to"].filter((key) => filters[key]).length;

  async function exportTrail() {
    try {
      const res = await api.get("/api/audit/export", { params, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-trail.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(await blobErrorMessage(err, "Export failed"), "error");
    }
  }

  if (loading && !data) return <Loader />;
  if (loadError && !data) {
    return (
      <ErrorState title="Could not load the audit trail" message={loadError} onRetry={load} />
    );
  }

  const entries = data?.entries || [];
  const counts = data?.counts || {};
  const options = data?.options || { actions: [], entities: [], users: [] };

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <BackLink to="/admin/dashboard" className="mb-2">
            Back
          </BackLink>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Oversight</p>
          <h1 className="mt-1 text-2xl font-bold">Audit trail</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Every create, edit, delete and group-wide operation, newest first — who did it, to which
            record, and what actually moved. The entries worth a second look are flagged: an amount
            cut, a row moved to another member, a phone number or ID changed, an account's role
            changed, a group-wide operation like a ledger reset.
          </p>
        </div>
        <button
          type="button"
          onClick={exportTrail}
          className="min-h-11 shrink-0 rounded-lg border border-rule bg-surface px-4 text-sm font-medium"
        >
          Export this view
        </button>
      </header>

      {/* The read on the window: what is in it, and how much of it is out of the
          ordinary. Counted over a bounded number of the newest matching entries, and
          the line underneath says so — a figure that quietly means "we looked at
          2,000 rows" is worse than one that admits it. */}
      <section>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile
            label="Unusual"
            value={counts.unusual ?? 0}
            hint="(anything flagged below)"
            alert={(counts.unusual ?? 0) > 0}
          />
          <Tile
            label="Serious"
            value={counts.serious ?? 0}
            hint="(money or access moved)"
            alert={(counts.serious ?? 0) > 0}
          />
          <Tile
            label="Money edited"
            value={counts.moneyChanged ?? 0}
            hint="(contributions, expenses, fines)"
          />
          <Tile label="Removed" value={counts.removed ?? 0} hint="(rows deleted)" />
        </div>
        <p className="mt-2 text-[11px] leading-5 text-muted">
          Counted over the {counts.scanned ?? 0} newest entries that match the filters below
          {data?.limited
            ? " — the newest window of a longer trail, so an older run of odd entries would sit outside it."
            : "."}{" "}
          {data ? `${data.total} ${data.total === 1 ? "entry" : "entries"} match.` : ""}
        </p>
      </section>

      {/* Filters, in the order a person narrows: the category first, because that is
          the question being asked, then who, when and what. */}
      <section className="rounded-xl border border-rule bg-surface p-4">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => change({ category: "" })}
            aria-pressed={!filters.category}
            className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${
              !filters.category
                ? "border-primary bg-primary/10 text-primary"
                : "border-rule text-muted"
            }`}
          >
            All
          </button>
          {(data?.categories || []).map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => toggleCategory(c.key)}
              aria-pressed={filters.category === c.key}
              className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${
                filters.category === c.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-rule text-muted"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Search and the unusual switch stay out; the rest folds away. A filter
            panel spread over two rows costs its scrolling on every visit, to answer
            a question most visits do not ask. */}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="audit-q" className="mb-1 block text-xs font-medium">
              Who or what
            </label>
            <input
              id="audit-q"
              type="search"
              placeholder="A member's name, or an entity"
              value={filters.q}
              onChange={(e) => change({ q: e.target.value })}
              className="h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
            />
          </div>

          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => {
                setUnusual((v) => !v);
                setPage(1);
              }}
              aria-pressed={unusual}
              className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${
                unusual ? "border-alert bg-alert/10 text-alert" : "border-rule text-muted"
              }`}
            >
              Unusual only
            </button>
            {filtered && (
              <button
                type="button"
                onClick={clearAll}
                className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium text-muted"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-primary">
            More filters
            {moreCount > 0 ? ` · ${moreCount} on` : ""}
          </summary>

          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="audit-action" className="mb-1 block text-xs font-medium">
                Action
              </label>
              <select
                id="audit-action"
                value={filters.action}
                onChange={(e) => change({ action: e.target.value })}
                className="h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              >
                <option value="">Any action</option>
                {options.actions.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a] || a}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="audit-entity" className="mb-1 block text-xs font-medium">
                Record type
              </label>
              <select
                id="audit-entity"
                value={filters.entity}
                onChange={(e) => change({ entity: e.target.value })}
                className="h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              >
                <option value="">Any record</option>
                {options.entities.map((t) => (
                  <option key={t} value={t}>
                    {entityLabel(t)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="audit-by" className="mb-1 block text-xs font-medium">
                Who did it
              </label>
              <select
                id="audit-by"
                value={filters.by}
                onChange={(e) => change({ by: e.target.value })}
                className="h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              >
                <option value="">Anyone</option>
                {options.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="audit-from" className="mb-1 block text-xs font-medium">
                From
              </label>
              <input
                id="audit-from"
                type="date"
                value={filters.from}
                onChange={(e) => change({ from: e.target.value })}
                className="h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="audit-to" className="mb-1 block text-xs font-medium">
                To
              </label>
              <input
                id="audit-to"
                type="date"
                value={filters.to}
                onChange={(e) => change({ to: e.target.value })}
                className="h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              />
            </div>
          </div>
        </details>
      </section>

      <section className="overflow-hidden rounded-xl border border-rule bg-surface">
        <div className="border-b border-rule px-4 py-2">
          <Pager
            page={data?.page || 1}
            pages={data?.pages || 1}
            total={data?.total || 0}
            from={data && data.total > 0 ? (data.page - 1) * data.limit + 1 : 0}
            to={data ? Math.min(data.page * data.limit, data.total) : 0}
            perPage={perPage}
            onPage={setPage}
            onPerPage={(n) => {
              setPerPage(n);
              setPage(1);
            }}
          />
        </div>

        {entries.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {unusual || filtered
              ? "Nothing matches those filters."
              : "No activity recorded yet."}
          </p>
        ) : (
          <ul className="divide-y divide-rule">
            {/* One line per entry, not a card: the trail is read by scanning for the
                row that looks wrong, and three stacked lines per entry turned fifty
                of them into two thousand pixels of scrolling. */}
            {entries.map((e) => (
              <li key={e._id} className="px-4 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold">{e.performedBy?.name || "Unknown"}</span>{" "}
                    <span className="text-muted">
                      {ACTION_LABELS[e.action] || e.action} {entityLabel(e.entityType)}
                    </span>
                  </span>

                  {e.summary && <span className="amount text-xs text-muted">· {e.summary}</span>}

                  {e.flags.map((flag) => (
                    <FlagChip key={flag.key} flag={flag} />
                  ))}

                  {/* The category is only worth printing when the reader is looking at
                      everything at once; filtered to Money, four hundred "Money" chips
                      are noise. */}
                  {!filters.category && e.flags.length === 0 && (
                    <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[11px] leading-4 text-muted">
                      {CATEGORY_LABELS[e.category] || e.category}
                    </span>
                  )}

                  <span className="amount ml-auto shrink-0 pl-2 text-[11px] text-muted">
                    {shortDateTime(e.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {data && data.pages > 1 && (
          <div className="border-t border-rule px-4 py-2">
            <Pager
              page={data.page}
              pages={data.pages}
              total={data.total}
              from={(data.page - 1) * data.limit + 1}
              to={Math.min(data.page * data.limit, data.total)}
              perPage={perPage}
              onPage={setPage}
              onPerPage={(n) => {
                setPerPage(n);
                setPage(1);
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}
