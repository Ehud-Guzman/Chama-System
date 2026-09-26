import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { useModal } from '../hooks/useModal';
import Modal from '../components/shared/Modal';
import ErrorState from '../components/shared/ErrorState';
import { money, shortDate, todayISO, isoDateOf, METHOD_LABELS } from '../utils/format';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import BackLink from '../components/shared/BackLink';
import Loader from '../components/shared/Loader';
import { fetchMember, getCachedMember, invalidateLedger } from '../services/ledgerCache';

const METHODS = Object.keys(METHOD_LABELS);

// The four things the treasurer can put on a member's page. `kind` maps
// straight onto the API's single write endpoint, and the amount each one
// prefills with is what members actually owe — so the usual entry is: tap the
// member, tap Weekly, paste the M-Pesa message, tap Log.
// The two things the treasurer can add to a member's page. Tea is not here on
// purpose — it is deducted automatically every week, so there is nothing to log
// and nothing to edit.
const KINDS = [
  { value: 'weekly', label: 'Weekly', hint: 'The weekly contribution due' },
  { value: 'expense', label: 'Expense', hint: 'Money spent from the Tea Fund' },
];

function Stat({ label, value, hint, accent, alert }) {
  return (
    <div className="rounded-xl border border-rule bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p
        className={`amount mt-1 text-lg font-bold ${
          alert ? 'text-alert' : accent ? 'text-primary' : ''
        }`}
      >
        {value}
      </p>
      {/* The explanation in brackets: these are the group's own figures, and a
          treasurer should be able to defend any one of them without a call. */}
      {hint && <p className="amount mt-1 text-[11px] leading-4 text-muted">{hint}</p>}
    </div>
  );
}

// One member's ledger. Rendered two ways, from the same code: as the panel that
// slides over the list when a name is tapped (no navigation, no new chunk, the
// list stays put underneath), and as the full page at /admin/finance/:id so a
// link to one member can still be shared or bookmarked.
// `onChanged` is how the panel tells the list underneath that the figures moved,
// so the totals behind it update in place instead of going stale.
export default function FinanceMemberLedger({ memberId, onClose, onChanged }) {
  const params = useParams();
  const id = memberId || params.id;
  const toast = useToast();

  // Painted straight from the cache when we have it, so a member the treasurer
  // looked at a moment ago opens instantly.
  const [data, setData] = useState(() => getCachedMember(id) || null);
  const [loading, setLoading] = useState(() => !getCachedMember(id));
  const [kind, setKind] = useState('weekly');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('mobile');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  // Open by default: the week list is the thing a treasurer checks against the
  // paper ledger, so it should never be the hidden half of the page.
  const [showWeeks, setShowWeeks] = useState(true);

  // Stable per-attempt key: it only rotates after a successful submit, so a
  // retried request resolves to the entry already written instead of charging
  // the member twice.
  const requestIdRef = useRef(crypto.randomUUID());
  const amountRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchMember(api, id);
      setData(res);
      return res;
    } catch (err) {
      toast(apiMessage(err, 'Could not load this member'), 'error');
      return null;
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const ledger = data?.ledger;
  const currentWeek = useMemo(() => ledger?.weeks?.find((w) => w.isCurrent), [ledger]);
  // Which week the entry is being logged against. Defaults to the week running
  // now; picking an older one is how a payment made late — or cash handed over
  // at a meeting weeks ago — gets put on the week it belongs to instead of
  // landing as anonymous credit on today's date.
  const [targetWeek, setTargetWeek] = useState(null);

  const selectedWeek = useMemo(
    () => ledger?.weeks?.find((w) => w.weekNumber === targetWeek) || currentWeek,
    [ledger, targetWeek, currentWeek]
  );

  // What the selected week still needs from him. Left blank once that week is
  // covered — logging the full amount again would silently become extra credit.
  const weekDue = selectedWeek
    ? Math.max(0, (ledger?.weeklyAmount || 0) - (selectedWeek.personalPaid || 0))
    : 0;

  // Set by the one-tap catch-up so the prefill below doesn't immediately
  // overwrite the total it just filled in: the amount and the week it belongs to
  // are decided together, and the effect that follows a week change would
  // otherwise reset it to a single week's due.
  const pendingFillRef = useRef(null);

  useEffect(() => {
    if (!ledger || !selectedWeek) return;
    if (pendingFillRef.current !== null) {
      setAmount(pendingFillRef.current);
      pendingFillRef.current = null;
      return;
    }
    if (kind === 'weekly') {
      // The opening week asks nothing of anybody, but the group still collects
      // that week's 1,400 — logged against it, the money becomes the credit that
      // covers the week after, so the same one-tap prefill applies there.
      const prefill = selectedWeek.isBaseline ? ledger.weeklyAmount : weekDue;
      setAmount(prefill > 0 ? String(prefill) : '');
    } else {
      setAmount('');
    }
  }, [kind, ledger, selectedWeek, weekDue]);

  // Picking a week also moves the date into it: a Friday-to-Thursday week means
  // the Thursday is the day the money was due, and today's date for a week still
  // running. Without this a back-filled week would be dated today and land in the
  // wrong week entirely.
  useEffect(() => {
    if (!selectedWeek) return;
    const end = new Date(selectedWeek.endDate);
    const today = new Date();
    setDate(isoDateOf(end.getTime() > today.getTime() ? today : end));
  }, [selectedWeek]);


  // One tap for the common catch-up case: he owes three weeks, so log the lot
  // against the earliest week he is behind on. The credit then flows forward
  // through the later weeks on its own, which is why there is no need to enter a
  // line per week — §7.5's cumulative credit does that work.
  function coverArrears() {
    const firstUnsettled = ledger?.weeks?.find((w) => !w.settled);
    if (!firstUnsettled) return;
    pendingFillRef.current = String(ledger.arrears);
    setKind('weekly');
    setTargetWeek(firstUnsettled.weekNumber);
  }

  async function submit(e) {
    e.preventDefault();
    const value = Number(String(amount).replace(/[,\s]/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      toast('Enter an amount greater than zero', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post(
        `/api/ledger/members/${id}/log`,
        {
          kind,
          amount: value,
          method,
          date,
          note: note.trim(),
          description: description.trim(),
          clientRequestId: requestIdRef.current,
        },
        {
          // If the phone has no signal, this entry goes into the outbox rather than being lost
          // (services/offlineQueue). Safe to queue *because* of `clientRequestId` above: the API
          // stores it under a unique index, so a replay resolves to the same payment instead of a
          // second one.
          offlineQueue: true,
          // What the banner calls it if it has to report that this one was refused later.
          offlineLabel: `${money(value)} for ${data?.member?.name || 'a member'}`,
        }
      );
      // A payment pays down pending fines first (oldest first). Say so: the figure
      // he sees move on the ledger is the net, and the difference has to be
      // accounted for out loud or it looks like money that went missing.
      const deducted = Number(res.data?.fineDeducted) || 0;
      toast(
        deducted > 0
          ? `${money(value)} logged — ${money(deducted)} went to his fines`
          : `${money(value)} logged`
      );
      requestIdRef.current = crypto.randomUUID();
      setNote('');
      setDescription('');
      // The list's totals are stale the moment money moves; drop the cache so
      // both this panel and the list behind it come back fresh. The list is
      // refreshed in place, not remounted, which is what keeps the screen from
      // blinking after every entry.
      invalidateLedger();
      await load();
      onChanged?.();
    } catch (err) {
      if (err.queuedOffline) {
        // Kept, and it will be sent when the signal comes back — so the next request needs a *new*
        // key. Reusing this one would make the API treat the treasurer's next, different payment as
        // a duplicate of the one now sitting in the outbox, and silently drop it. That is the one
        // way an outbox loses money instead of saving it.
        requestIdRef.current = crypto.randomUUID();
        setNote('');
        setDescription('');
        toast('No signal — kept, and it will be sent when you are back online');
      } else {
        toast(apiMessage(err), 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      const path = deleting.kind === 'expense' ? `/api/expenses/${deleting._id}` : `/api/contributions/${deleting._id}`;
      await api.delete(path);
      toast('Entry deleted');
      setDeleting(null);
      invalidateLedger();
      await load();
      onChanged?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // The panel and the page are the same markup. As a panel it floats over the
  // list — nothing unmounts behind it, so closing it is instant and the list is
  // exactly where it was, scroll and all. As an overlay it uses the shared dialog
  // behaviour: Escape closes it, Tab stays inside it, the list behind stops
  // scrolling, and focus comes back to the name that was tapped.
  const panelRef = useModal(Boolean(onClose), onClose);

  const frame = (content) =>
    onClose ? (
      <Modal
        className="fixed inset-0 z-50 flex justify-end bg-black/40"
        role="dialog"
        aria-modal="true"
        aria-label="Member ledger"
        onBackdropClick={onClose}
      >
        <div
          ref={panelRef}
          className="h-full w-full max-w-3xl overflow-y-auto bg-canvas p-4 shadow-xl md:p-6"
        >
          {content}
        </div>
      </Modal>
    ) : (
      content
    );

  if (loading) return frame(<Loader />);
  if (!data) {
    return frame(
      <ErrorState
        title="Could not load this member"
        message="The connection dropped or timed out. Nothing has been lost — try again."
        onRetry={() => {
          setLoading(true);
          load();
        }}
      />
    );
  }

  const { member, week, logs, expenses } = data;
  const teaFund = (data.funds || []).find((f) => f.name.toLowerCase().includes('chai')) || null;
  const owed = ledger.movement < 0;

  return frame(
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="-ml-2 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-primary"
            >
              ← Back to the list
            </button>
          ) : (
            <BackLink to="/admin/finance">All members</BackLink>
          )}
          <h1 className="mt-1 truncate text-2xl font-bold">{member.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {[member.regNumber, member.phone].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 text-xs text-muted">
            Week {week.currentWeek} · {shortDate(week.startDate)} → {shortDate(week.endDate)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            to={`/admin/members/${member._id}`}
            className="min-h-11 rounded-lg border border-rule bg-surface px-4 text-sm font-medium leading-[2.75rem]"
          >
            Member record
          </Link>

          {/* A panel this tall needs an obvious way out at the top as well as the
              back link, and it has to be a real tap target rather than a text link. */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the member ledger"
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-rule bg-surface text-xl leading-none text-muted"
            >
              ×
            </button>
          )}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label={`Carried in at week ${data.week.cycleStartWeek}`}
          value={money(ledger.openingBalance)}
          hint="(what the paper ledger held for him when these books opened)"
        />
        <Stat
          label="Money he holds"
          value={money(ledger.money)}
          hint="(carried in + paid in − tea)"
          accent
        />
        <Stat
          label="Weeks that have closed"
          value={money(ledger.required)}
          hint={`(expected so far: ${money(ledger.weeklyAmount)} × the ${ledger.chai.weeks} week${
            ledger.chai.weeks === 1 ? '' : 's'
          } — not taken off the money he holds)`}
        />
        <Stat
          label={owed ? 'Owed' : 'Extra saved'}
          value={money(owed ? ledger.arrears : ledger.credit)}
          hint={
            owed
              ? (ledger.chasedArrears ?? ledger.arrears) > 0
                ? '(closed weeks still unpaid)'
                : `(closed weeks still unpaid — not chased: he holds more than ${money(
                    ledger.moneyLimit
                  )})`
              : '(paid more than was due so far)'
          }
          alert={owed && (ledger.chasedArrears ?? ledger.arrears) > 0}
        />
        <Stat
          label={`Tea — ${ledger.chai.weeks} week${ledger.chai.weeks === 1 ? '' : 's'}`}
          value={money(ledger.chai.due)}
          hint={`(deducted automatically, ${money(ledger.chai.perWeek)} a week)`}
        />
      </section>

      <p className="rounded-xl border border-rule bg-canvas px-4 py-3 text-xs leading-5 text-muted">
        {money(ledger.openingBalance)} carried in at week {data.week.cycleStartWeek} +{' '}
        {money(ledger.paid)} paid in since then − {money(ledger.chai.due)} tea ={' '}
        <span className="amount font-semibold">{money(ledger.money)}</span> held for him. The weeks
        that have closed ({money(ledger.required)}) are what the group expected of him, not money
        taken off him: a week he has not paid is the {money(ledger.arrears)} he owes beside it, and
        his held figure is what he actually handed over.
        {(ledger.chasedArrears ?? ledger.arrears) === 0 && ledger.arrears > 0 && (
          <>
            {' '}
            <span className="font-semibold">
              He is above the {money(ledger.moneyLimit)} line, so that uncollected week is not
              chased and he is not told he is behind
            </span>{' '}
            — it stays on his record and is logged whenever he brings it.
          </>
        )}
        {' '}While the expectation was still being
        deducted, this figure read{' '}
        <span className="amount font-semibold">{money(ledger.moneyNetOfDues ?? ledger.money)}</span>{' '}
        — the same books, with the {money(ledger.required)} shown as owed instead of taken out. Tea is{' '}
        {money(ledger.chai.perWeek)} a week, deducted automatically from every member and paid into the
        Group’s Tea Fund — nobody owes it and nobody pays arrears on it.
        {ledger.nillWeeksDueFine.length > 0 &&
          ` ${ledger.nillWeeksDueFine.length} closed week(s) were NILL with no credit standing (${ledger.nillWeeksDueFine
            .map((w) => 'W' + w)
            .join(', ')}) — the 50 fine under clause 7.5 has not been charged.`}
      </p>

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)] lg:items-start">
        {/* Add a log — the one write the treasurer needs */}
        <form
          onSubmit={submit}
          className="min-w-0 space-y-4 rounded-xl border border-rule bg-surface p-4"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Add a log</p>
            <p className="mt-1 text-sm text-muted">
              {KINDS.find((k) => k.value === kind)?.hint}
            </p>
          </div>

          <fieldset>
            <legend className="mb-2 text-xs font-medium">Which week is this for?</legend>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {[...ledger.weeks].reverse().map((w) => {
                const isPicked = selectedWeek?.weekNumber === w.weekNumber;
                return (
                  <button
                    key={w.weekNumber}
                    type="button"
                    onClick={() => setTargetWeek(w.weekNumber)}
                    aria-pressed={isPicked}
                    title={`${shortDate(w.startDate)} → ${shortDate(w.endDate)}`}
                    className={`min-w-20 shrink-0 rounded-lg border px-3 py-2 text-center ${
                      isPicked ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
                    }`}
                  >
                    <span className="amount block text-sm font-bold">W{w.weekNumber}</span>
                    <span className="mt-0.5 block text-[11px] uppercase tracking-wide">
                      {w.isBaseline
                        ? 'opening'
                        : w.isCurrent
                          ? 'now'
                          : w.settled
                            ? 'settled'
                            : 'owing'}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedWeek && (
              <p className="mt-2 text-xs text-muted">
                Logging against week {selectedWeek.weekNumber} ({shortDate(selectedWeek.startDate)} →{' '}
                {shortDate(selectedWeek.endDate)})
                {selectedWeek.isBaseline
                  ? ` — the opening week. Nothing was due for it, because his money for it is the ${money(
                      ledger.openingBalance
                    )} he carried in; the week's ${money(
                      ledger.weeklyAmount
                    )} is still collected, and it stands as extra saved against week ${
                      selectedWeek.weekNumber + 1
                    }.`
                  : selectedWeek.isCurrent
                    ? ` — the week running now. Its ${money(
                        ledger.weeklyAmount
                      )} is only counted the day after it closes, so logging it here is what settles it.`
                    : selectedWeek.settled
                      ? ' — already settled, so anything logged now counts as extra saved.'
                      : ` — ${money(weekDue)} of the ${money(ledger.weeklyAmount)} still due.`}
              </p>
            )}
            {data.history?.length > 0 && (
              <p className="mt-2 text-xs leading-5 text-muted">
                Weeks 1–{data.history[data.history.length - 1].weekNumber} are listed on the week table
                below for reference. They ran before this ledger opened and their money is already
                inside his brought-forward balance, so they are not scored — to correct one of those
                weeks, change his opening balance instead.
              </p>
            )}
          </fieldset>

          {ledger.weeksBehind > 0 && (
            <button
              type="button"
              onClick={coverArrears}
              className="min-h-11 w-full rounded-lg border border-alert/40 bg-alert/5 px-3 text-xs font-semibold text-alert"
            >
              He is {ledger.weeksBehind} week{ledger.weeksBehind === 1 ? '' : 's'} behind ({' '}
              {money(ledger.arrears)} owed) — log it all and catch him up
            </button>
          )}
          {/* Above the group's line the uncollected week is not chased (utils/reminderLimit): the
              treasurer still needs to see it, and to be able to log it when the member brings it —
              so the button stays, and what changes is that it no longer calls him behind. */}
          {(ledger.chasedArrears ?? ledger.arrears) === 0 && ledger.arrears > 0 && (
            <button
              type="button"
              onClick={coverArrears}
              className="min-h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-xs font-semibold text-muted"
            >
              Ahead of the cycle — {ledger.weeksBehind} closed week
              {ledger.weeksBehind === 1 ? '' : 's'} uncollected ({money(ledger.arrears)}), not chased
              {ledger.moneyLimit > 0 ? ` above ${money(ledger.moneyLimit)}` : ''} — log it when he
              brings it
            </button>
          )}

          <fieldset>
            <legend className="mb-2 text-xs font-medium">What is this?</legend>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  aria-pressed={kind === k.value}
                  className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${
                    kind === k.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-rule text-muted'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="log-amount" className="mb-1 block text-xs font-medium">
                Amount
              </label>
              <input
                id="log-amount"
                ref={amountRef}
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="amount h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-base font-semibold"
              />
            </div>
            <div>
              <label htmlFor="log-date" className="mb-1 block text-xs font-medium">
                Date
              </label>
              <input
                id="log-date"
                type="date"
                max={todayISO()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              />
            </div>
          </div>

          {kind === 'weekly' && weekDue === 0 && (
            <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
              That week is already settled. Anything logged now counts as extra credit on top.
            </p>
          )}

          <fieldset>
            <legend className="mb-2 text-xs font-medium">Paid by</legend>
            <div className="grid grid-cols-4 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  aria-pressed={method === m}
                  className={`min-h-11 rounded-lg border text-xs font-semibold ${
                    method === m ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
                  }`}
                >
                  {METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          </fieldset>

          {kind === 'expense' && (
            <div>
              <label htmlFor="log-description" className="mb-1 block text-xs font-medium">
                What was it for?
              </label>
              <input
                id="log-description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Tea and mandazi"
                className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              />
            </div>
          )}

          <div>
            <label htmlFor="log-note" className="mb-1 block text-xs font-medium">
              Note <span className="font-normal text-muted">— paste the M-Pesa or bank message here</span>
            </label>
            <textarea
              id="log-note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="SK9X2Q1LMN Confirmed. Ksh1,400.00 sent to WAZO MOJA SELF-HELP GROUP on 17/9/26 at 8:04 AM."
              className="w-full rounded-lg border border-rule bg-canvas px-3 py-2 text-sm leading-5"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="min-h-12 w-full rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Logging…' : 'Log it'}
          </button>
        </form>

        <div className="min-w-0 space-y-5">
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
                His entries ({logs.length})
              </h2>
              <button
                type="button"
                onClick={() => setShowWeeks((v) => !v)}
                className="-mr-2 -my-1 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-primary"
              >
                {showWeeks ? 'Hide weeks' : 'Week by week'}
              </button>
            </div>

            {logs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
                Nothing logged for {member.name} since week {week.currentWeek} yet.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
                {logs.map((l) => (
                  <li key={l._id} className="flex items-start gap-3 border-b border-rule px-4 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {shortDate(l.date)}
                        <span className="text-muted">
                          {' · '}W{l.week} · {l.typeName || 'Contribution'} ·{' '}
                          {METHOD_LABELS[l.method] || l.method}
                        </span>
                      </p>
                      {l.note && (
                        <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-canvas px-3 py-2 text-xs leading-5 text-muted">
                          {l.note}
                        </p>
                      )}
                    </div>
                    <p className="amount shrink-0 font-semibold">{money(l.amount)}</p>
                    <button
                      type="button"
                      onClick={() => setDeleting({ ...l, kind: 'contribution' })}
                      aria-label={`Delete ${money(l.amount)} on ${shortDate(l.date)}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-alert"
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {showWeeks && (
            <section className="overflow-x-auto rounded-xl border border-rule bg-surface">
              <table className="w-full text-sm">
                <thead className="border-b border-rule bg-canvas">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">Week</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">Paid in</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">Tea (auto)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ledger.weeks].reverse().map((w) => (
                    <tr key={w.weekNumber} className="border-b border-rule last:border-b-0">
                      <td className="amount px-3 py-2">
                        {w.weekNumber}
                        {w.isCurrent && (
                          <span className="ml-1 text-[11px] uppercase tracking-wide text-primary">now</span>
                        )}
                      </td>
                      <td className="amount px-3 py-2">{money(w.personalPaid)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest ${
                            w.status === 'paid'
                              ? 'bg-primary/10 text-primary'
                              : w.status === 'partial'
                                ? 'bg-accent/10 text-accent'
                                : w.nillFineDue
                                  ? 'bg-alert/10 text-alert'
                                  : 'bg-canvas text-muted'
                          }`}
                        >
                          {w.isBaseline
                            ? 'opening'
                            : w.status === 'paid'
                              ? 'paid in full'
                              : w.status === 'partial'
                                ? 'partly paid'
                                : 'nothing paid'}
                          {w.coveredByCredit ? ' (covered by earlier extra)' : ''}
                        </span>
                      </td>
                      <td className="amount px-3 py-2 text-muted">
                        {money(w.chaiAmount ?? ledger.chaiAmount)}
                      </td>
                    </tr>
                  ))}

                  {data.history?.length > 0 && (
                    <>
                      <tr className="border-b border-rule bg-canvas">
                        <td colSpan={4} className="px-3 py-2 text-xs leading-5 text-muted">
                          Weeks 1–{data.history[data.history.length - 1].weekNumber} ran before this ledger
                          opened. Their money is already inside the {money(ledger.openingBalance)} brought
                          forward, so they are listed for reference and never scored again.
                        </td>
                      </tr>
                      {[...data.history].reverse().map((w) => {
                        // A week before the cycle that was collected — the one-time
                        // week-91 entry — shows its money and its tea. The rest are
                        // carried forward inside the opening balance, which is what
                        // the row above explains.
                        const collected = w.paid > 0 || w.chaiPaid > 0;
                        return (
                          <tr
                            key={w.weekNumber}
                            className="border-b border-rule text-muted last:border-b-0"
                          >
                            <td className="amount px-3 py-2">{w.weekNumber}</td>
                            <td className="amount px-3 py-2">{collected ? money(w.paid || 0) : '—'}</td>
                            <td className="px-3 py-2">
                              {collected ? (
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-primary">
                                  paid in
                                </span>
                              ) : (
                                <span className="text-xs">counted in his carried-in money</span>
                              )}
                            </td>
                            <td className="amount px-3 py-2">
                              {collected && w.chaiPaid > 0 ? money(w.chaiPaid) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  )}
                </tbody>
              </table>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
                Fund spending{teaFund ? ` — Tea Fund holds ${money(teaFund.balance)}` : ''}
              </h2>
              {/* The group's whole spending record, where an expense is a row of its own
                  rather than something attached to this member. */}
              <Link
                to="/admin/finance/expenses"
                className="-mr-2 -my-1 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-primary"
              >
                All spending
              </Link>
            </div>
            {expenses.length === 0 ? (
              <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
                Nothing spent from the funds yet.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
                {expenses.map((x) => (
                  <li key={x._id} className="flex items-start gap-3 border-b border-rule px-4 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {x.description || 'Expense'}
                        <span className="text-muted">
                          {' · '}
                          {x.typeId?.name ? `${x.typeId.name} · ` : ''}
                          {shortDate(x.date)}
                        </span>
                      </p>
                      {x.note && (
                        <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-canvas px-3 py-2 text-xs leading-5 text-muted">
                          {x.note}
                        </p>
                      )}
                    </div>
                    <p className="amount shrink-0 font-semibold text-alert">{money(x.amount)}</p>
                    <button
                      type="button"
                      onClick={() => setDeleting({ ...x, kind: 'expense' })}
                      aria-label={`Delete expense of ${money(x.amount)}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-alert"
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleting}
        title={deleting?.kind === 'expense' ? 'Delete this expense?' : 'Delete this entry?'}
        body={
          deleting
            ? `${money(deleting.amount)} on ${shortDate(deleting.date)}. The record stays in the audit trail.`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// One icon, used by both delete buttons — inline SVG, no icon library, matching
// LedgerRows.
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}




