import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { money, shortDate } from '../../utils/format';
import Loader from '../shared/Loader';
import FinanceMemberLedger from '../../pages/FinanceMemberLedger';
import {
  fetchLedger,
  getCachedLedger,
  prefetchMember,
  revalidateLedger,
} from '../../services/ledgerCache';

// The one logging surface in the system. Every dashboard that logs money shows
// this and nothing else: the week's figures, then a list of names — a tap opens
// that member's page, where the actual logging happens.
//
// It owns its own data fetch and its own header, which is what makes "all the
// logging dashboards are the same" literally true rather than approximately
// true: the treasurer's page and an admin's dashboard render the same component.
// `showHeader` lets a page drop the header when it already states the week, and
// `action` is where a page adds its own button next to it.
const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'arrears', label: 'Most owed' },
  { value: 'money', label: 'Most money held' },
];

function Stat({ label, value, hint, accent, alert }) {
  return (
    <div className="rounded-xl border border-rule bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p
        className={`amount mt-1 text-lg font-bold md:text-2xl ${
          alert ? 'text-alert' : accent ? 'text-primary' : ''
        }`}
      >
        {value}
      </p>
      {/* Every money label in this app carries its own explanation in brackets:
          the terms the paper ledger used are not the terms a new treasurer knows,
          and a figure nobody can define is a figure nobody checks. */}
      {hint && <p className="amount mt-1 text-[11px] leading-4 text-muted">{hint}</p>}
    </div>
  );
}

// Every pill keeps its explanation for a screen with room for it and drops it on a
// phone, where an uppercase pill with wide tracking is what pushes a member's name
// off the row. The row's own line underneath carries the reason either way.
function StatusPill({ member, baselineWeek }) {
  const pill =
    "inline-block max-w-full whitespace-normal rounded-full px-2 py-1 text-[11px] font-bold uppercase leading-4 tracking-widest";

  // The money the group *chases*: 0 for a member holding at least the group's line, whom the group
  // has decided not to tell he is behind (Settings → Reminders, utils/reminderLimit). `arrears` is
  // still on the row as the plain record of what is uncollected — the pill names it either way — and
  // an older payload with no chased figure falls back to the plain one, which is the safe way to be
  // wrong: it never tells a member he is fine when he is not.
  const chased = member.chasedArrears ?? member.arrears;
  const weeks = member.chasedWeeksBehind ?? member.weeksBehind;

  if (chased > 0) {
    return (
      <span className={`${pill} bg-alert/10 text-alert`}>
        {money(chased)} owed
        {weeks > 0 && (
          <span className="hidden sm:inline">
            {" "}
            ({weeks} week{weeks === 1 ? "" : "s"} behind)
          </span>
        )}
      </span>
    );
  }
  // Above the line with a week still uncollected: nothing is being asked of him, so the pill says
  // that in the neutral tone rather than in the red one the chase uses.
  if (member.arrears > 0) {
    return (
      <span className={`${pill} bg-canvas text-muted`}>
        Ahead of the cycle
        <span className="hidden sm:inline">
          {" "}
          — {money(member.arrears)} not collected (he holds more than {money(member.moneyLimit)})
        </span>
      </span>
    );
  }
  // The opening week asks nothing of anybody — every member's money for it is the
  // balance he brought forward — so "settled" would be the wrong word for it.
  if (baselineWeek) {
    return (
      <span className={`${pill} bg-canvas text-muted`}>
        Opening week
        <span className="hidden sm:inline"> · nothing due</span>
      </span>
    );
  }
  // No week of the cycle has closed yet, so there is nothing to be settled about:
  // the member who has paid ahead and the one who has paid nothing carry the same
  // pill, because neither owes. What his money is doing is the row's own line, not
  // the pill's job. (Undefined from an older API reads as "settled", which is what
  // this pill said before the count existed — the safe way to be wrong.)
  if (member.weeksScored === 0) {
    return (
      <span className={`${pill} bg-canvas text-muted`}>
        Nothing due yet
        <span className="hidden sm:inline"> (no week has closed)</span>
      </span>
    );
  }
  return (
    <span className={`${pill} bg-primary/10 text-primary`}>
      Settled
      <span className="hidden sm:inline"> (every closed week paid)</span>
    </span>
  );
}

// What a member's row says under his money. The bracket answers one question —
// what is this money doing? — so it changes with his position rather than
// restating the group's clock at him:
//
//   paid and nothing due yet   → extra saved, waiting for the weeks to close
//   paid more than is due      → the rest is extra saved
//   paid, less than is due     → the closed weeks he has covered
//   paid nothing, nothing due  → the state, with the rule that produces it
//
// Kept short on purpose: these lines share a phone screen with a member's name, and
// an explanation that wraps to four lines is its own kind of breakage.
function paidLine(m) {
  if (m.required > 0) {
    return m.paid > m.required
      ? `${money(m.paid)} paid of ${money(m.required)} due (the rest is extra saved)`
      : `${money(m.paid)} paid of ${money(m.required)} due (weeks that have closed)`;
  }
  return m.paid > 0
    ? `${money(m.paid)} paid in (extra saved — nothing due yet)`
    : `${money(m.paid)} paid in (nothing due yet — no week has closed)`;
}

export default function MemberLedgerList({
  onLoaded,
  showHeader = false,
  action = null,
  // The header is the page's header, so the page words it: the finance screen says
  // "Finance / Week 93", the dashboard says "Dashboard / Hello, Anne" — one screen,
  // one title, instead of a greeting card stacked on top of a second header.
  eyebrow = 'Finance',
  heading = null,
  hint = null,
  // A cap for pages that are not the ledger itself. The dashboard opens on the
  // logging list, but it is not the place to read through 32 names to reach the
  // tools underneath; /admin/finance still lists everybody, and `moreHref` hands
  // over to it. A search always looks through the whole list, cap or no cap.
  limit = 0,
  moreHref = null,
  // Which order the list opens in. The finance ledger opens alphabetically — it is
  // where a name is looked up — while the dashboard opens on who is behind, so its
  // eight rows are the eight that matter rather than the first eight in the alphabet.
  defaultSort = 'name',
}) {
  const toast = useToast();
  // Straight from the cache when the page was visited a moment ago, so switching
  // between the dashboard and the ledger paints immediately instead of flashing a
  // spinner while the same list is fetched all over again.
  const [data, setData] = useState(() => getCachedLedger());
  const [loading, setLoading] = useState(() => !getCachedLedger());
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(defaultSort);
  // The member whose panel is open, if any — the panel is part of this screen, so
  // tapping a name never leaves the page.
  const [openMember, setOpenMember] = useState(null);

  // Re-reads the list after money moves, so the totals behind the open panel
  // follow the entry instead of waiting for a remount. The panel clears the cache
  // before calling this, so the fetch is a real one.
  const refresh = useCallback(async () => {
    try {
      const d = await fetchLedger(api);
      setData(d);
      onLoaded?.(d);
    } catch (err) {
      toast(apiMessage(err, 'Could not load the ledger'), 'error');
    }
    // onLoaded is deliberately left out: callers pass an inline function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedLedger();
    fetchLedger(api)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        onLoaded?.(d);
      })
      .catch((err) => toast(apiMessage(err, 'Could not load the ledger'), 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Painted from the cache? Then quietly ask for the current figures too. An
    // instant list a few seconds old beats a spinner, and this is what stops it
    // from being minutes old on a phone left open on the dashboard while somebody
    // else is logging money.
    if (cached) {
      revalidateLedger(api).then((d) => {
        if (!cancelled && d) setData(d);
      });
    }
    return () => {
      cancelled = true;
    };
    // onLoaded is deliberately left out: callers pass an inline function, and
    // re-fetching the whole ledger on every render would be far worse than a
    // stale callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const members = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data?.members || []).filter(
      (m) =>
        !q ||
        m.name.toLowerCase().includes(q) ||
        (m.regNumber || '').toLowerCase().includes(q) ||
        (m.nationalId || '').toLowerCase().includes(q) ||
        m.phone.includes(q)
    );
    return [...list].sort((a, b) => {
      if (sort === 'arrears') return b.arrears - a.arrears || a.name.localeCompare(b.name);
      if (sort === 'money') return b.money - a.money || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
  }, [data, search, sort]);

  // Capped only when nobody is searching: a search that could not find a name
  // because it fell outside the first eight would be worse than no search at all.
  const capped = limit > 0 && !search.trim();
  const shown = capped ? members.slice(0, limit) : members;

  if (loading) return <Loader />;

  const week = data?.week;
  const totals = data?.totals;
  // While the books are still in the opening week, nobody is expected to have paid
  // into it, so the list says so rather than calling everyone owed or settled.
  const isBaselineWeek = Boolean(week && week.currentWeek === week.cycleStartWeek);

  return (
    <div className="min-w-0 space-y-4">
      {showHeader && week && (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">{eyebrow}</p>
              <h1 className="mt-1 text-2xl font-bold">
                {heading || `Week ${week.currentWeek}`}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {shortDate(week.startDate)} → {shortDate(week.endDate)} · {money(week.weeklyAmount)} a
                week each (the weekly contribution) · {money(week.chaiAmount)} tea (deducted
                automatically every closed week)
              </p>
              {hint && <p className="mt-1 max-w-md text-xs leading-5 text-muted">{hint}</p>}
            </div>
            {action}
          </header>

          {totals && (
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="Money held by members"
                value={money(totals.money)}
                hint={`(carried in + paid in − tea). Weeks nobody paid are owed, not taken off this — together they read ${money(totals.moneyNetOfDues ?? totals.money)}.`}
                accent
              />
              <Stat
                label={`Carried in at week ${week.cycleStartWeek}`}
                value={money(totals.openingBalance)}
                hint="(what the paper ledger held when these books opened)"
              />
              <Stat
                label={`Paid in since week ${week.cycleStartWeek}`}
                value={money(totals.paid)}
                hint="(contributions logged on this ledger)"
              />
              <Stat
                label="Owed by members"
                value={money(totals.arrears)}
                hint={`(closed weeks still unpaid)${
                  (totals.notChasedArrears ?? 0) > 0
                    ? ` — of which ${money(totals.notChasedArrears)} is not chased: those members hold more than the group's line`
                    : ''
                }`}
                alert={(totals.chasedArrears ?? totals.arrears) > 0}
              />
            </section>
          )}
        </>
      )}

      {/* Where the dashboard's "Log a payment" lands, and where the eye should start:
          the search box, not the top of the page. scroll-mt clears the sticky header. */}
      <div id="log-money" className="flex scroll-mt-20 flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search name, phone, ID or reg no."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-12 min-w-0 flex-1 rounded-xl border border-rule bg-surface px-4 text-sm"
          aria-label="Search members"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="h-12 rounded-xl border border-rule bg-surface px-3 text-sm"
          aria-label="Sort members"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {members.length === 0 ? (
        <p className="rounded-xl border border-dashed border-rule px-5 py-10 text-center text-sm text-muted">
          {search ? 'No members match that search.' : 'No active members yet.'}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
          {shown.map((m) => (
            <li key={m._id} className="border-b border-rule last:border-b-0">
              <button
                type="button"
                // Prefetch on press so the panel usually has its data before the
                // tap completes; the whole screen stays put either way.
                onPointerDown={() => prefetchMember(api, m._id)}
                onClick={() => setOpenMember(m._id)}
                className="block w-full px-4 py-3 text-left transition-colors hover:bg-canvas active:bg-canvas"
              >
                <span className="flex items-start gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{m.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {[m.regNumber, m.phone].filter(Boolean).join(' · ')}
                    </span>
                    <span className="mt-1 block">
                      <StatusPill member={m} baselineWeek={isBaselineWeek} />
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[11px] font-semibold uppercase tracking-widest text-muted">
                      Money held
                    </span>
                    <span className="amount block whitespace-nowrap text-base font-bold">
                      {money(m.money)}
                    </span>
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    className="mt-1.5 h-4 w-4 shrink-0 text-muted"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>

                {/* The two explanatory lines take the row's whole width rather than
                    sitting in the column beside the figure. Squeezed into that
                    column they are what pushed a phone's row past the screen edge —
                    there is no room for a sentence next to a number on a 360px
                    phone. */}
                <span className="amount mt-1.5 block text-[11px] leading-4 text-muted">
                  {paidLine(m)}
                </span>
                <span className="amount block text-[11px] leading-4 text-muted">
                  tea {money(m.chaiPaid)} (deducted automatically)
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {capped && moreHref && (
        <Link
          to={moreHref}
          className="flex min-h-12 w-full items-center justify-center gap-1 rounded-xl border border-dashed border-rule bg-surface text-sm font-semibold text-primary"
        >
          Show all {members.length} members →
        </Link>
      )}

      {/* The member's ledger, over the list rather than instead of it. Closing it
          puts the treasurer back exactly where they were, and logging inside it
          refreshes the list underneath in place — no remount, no spinner. */}
      {openMember && (
        <FinanceMemberLedger
          memberId={openMember}
          onClose={() => setOpenMember(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

