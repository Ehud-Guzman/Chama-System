import { useEffect, useMemo, useState, useCallback } from 'react';
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
  { value: 'arrears', label: 'Most behind' },
  { value: 'money', label: 'Most money' },
];

function Stat({ label, value, accent, alert }) {
  return (
    <div className="rounded-xl border border-rule bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p
        className={`amount mt-1 text-lg font-bold md:text-2xl ${
          alert ? 'text-alert' : accent ? 'text-primary' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function StatusPill({ member }) {
  if (member.arrears > 0) {
    const weeks =
      member.weeksBehind > 0
        ? ` · ${member.weeksBehind} week${member.weeksBehind === 1 ? '' : 's'}`
        : '';
    return (
      <span className="rounded-full bg-alert/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-alert">
        {money(member.arrears)} behind{weeks}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
      Settled
    </span>
  );
}

export default function MemberLedgerList({ onLoaded, showHeader = false, action = null }) {
  const toast = useToast();
  // Straight from the cache when the page was visited a moment ago, so switching
  // between the dashboard and the ledger paints immediately instead of flashing a
  // spinner while the same list is fetched all over again.
  const [data, setData] = useState(() => getCachedLedger());
  const [loading, setLoading] = useState(() => !getCachedLedger());
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
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
        m.phone.includes(q)
    );
    return [...list].sort((a, b) => {
      if (sort === 'arrears') return b.arrears - a.arrears || a.name.localeCompare(b.name);
      if (sort === 'money') return b.money - a.money || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
  }, [data, search, sort]);

  if (loading) return <Loader />;

  const week = data?.week;
  const totals = data?.totals;

  return (
    <div className="min-w-0 space-y-4">
      {showHeader && week && (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">Finance</p>
              <h1 className="mt-1 text-2xl font-bold">Week {week.currentWeek}</h1>
              <p className="mt-1 text-sm text-muted">
                {shortDate(week.startDate)} → {shortDate(week.endDate)} · {money(week.weeklyAmount)} a
                week per member · {money(week.chaiAmount)} tea
              </p>
            </div>
            {action}
          </header>

          {totals && (
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Held by members" value={money(totals.money)} accent />
              <Stat label="Brought forward at week 92" value={money(totals.openingBalance)} />
              <Stat label="Collected since week 92" value={money(totals.paid)} />
              <Stat label="Behind in total" value={money(totals.arrears)} alert={totals.arrears > 0} />
            </section>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search name, phone or reg number"
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
          {members.map((m) => (
            <li key={m._id} className="border-b border-rule last:border-b-0">
              <button
                type="button"
                // Prefetch on press so the panel usually has its data before the
                // tap completes; the whole screen stays put either way.
                onPointerDown={() => prefetchMember(api, m._id)}
                onClick={() => setOpenMember(m._id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{m.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {[m.regNumber, m.phone].filter(Boolean).join(' · ')}
                  </span>
                  <span className="mt-1 block">
                    <StatusPill member={m} />
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="amount block text-base font-bold">{money(m.money)}</span>
                  <span className="amount block text-xs text-muted">
                    {money(m.paid)} of {money(m.required)}
                  </span>
                  <span className="amount block text-xs text-muted">
                    tea (auto) {money(m.chaiPaid)}
                  </span>
                </span>
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 text-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
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

