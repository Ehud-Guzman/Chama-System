import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { useModal } from '../hooks/useModal';
import Modal from '../components/shared/Modal';
import ErrorState from '../components/shared/ErrorState';
import { money, shortDate, todayISO, isoDateOf } from '../utils/format';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import BackLink from '../components/shared/BackLink';
import LedgerWalk from '../components/shared/LedgerWalk';
import Loader from '../components/shared/Loader';
import { fetchMember, getCachedMember, invalidateLedger } from '../services/ledgerCache';
import { parseMpesaMessage } from '../utils/mpesaMessage';
import CompactStat from '../components/shared/CompactStat';
import AddLogForm from './memberLedger/AddLogForm';
import LedgerEntries from './memberLedger/LedgerEntries';

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
  // Set when the API says this payment's M-Pesa code is already on another one.
  const [duplicate, setDuplicate] = useState('');
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

  const pasted = useMemo(() => parseMpesaMessage(note), [note]);
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
  // covered — logging the full amount again would silently become money on top.
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
      // The opening week asks nothing of anybody, but the group still collects that week's 1,400 —
      // logged against it, it is simply his money (nothing was due for the opening week, and each
      // later week still asks for its own 1,400).
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


  // What the earliest closed week still short is asking for — one tap per week, because each week
  // carries its own 1,400: a surplus logged on an earlier week is that week's money for the group,
  // never the next week's payment (utils/memberLedger). So catching him up is one line per week he
  // missed, dated in the week it belongs to, exactly as the paper ledger was written.
  function coverArrears() {
    const firstShort = ledger?.weeks?.find((w) => w.behind);
    if (!firstShort) return;
    pendingFillRef.current = String(firstShort.shortfall);
    setKind('weekly');
    setTargetWeek(firstShort.weekNumber);
  }

  async function submit(e, confirmDuplicate = false) {
    e?.preventDefault?.();
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
          // Said only after the API has pointed out the earlier payment and the treasurer has
          // confirmed this is a second one.
          ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
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
      setDuplicate('');
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
      } else if (err.response?.status === 409 && err.response?.data?.needsConfirmation) {
        // The same M-Pesa code is already on a payment: say which, and let the treasurer decide.
        setDuplicate(err.response.data.message);
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
  // Whether anything is being asked of him at all: below the group's line and short of a closed
  // week, he is chased; above it, nothing is asked (utils/reminderLimit).
  const owed = (ledger.chasedArrears ?? ledger.arrears) > 0;
  // The earliest closed week the money is missing from — the one a catch-up payment is logged
  // against. Each week carries its own 1,400, so there is one line per week, never a lump.
  const firstShortWeek = (ledger.weeks || []).find((w) => w.behind) || null;

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
        <CompactStat
          label={`Carried in at week ${data.week.cycleStartWeek}`}
          value={money(ledger.openingBalance)}
          hint="(what the paper ledger held for him when these books opened)"
        />
        <CompactStat
          label="Money he holds"
          value={money(ledger.money)}
          hint={ledger.finesPaid > 0 ? '(carried in + paid in − tea − fines paid out of his money)' : '(carried in + paid in − tea)'}
          accent
        />
        <CompactStat
          label="Weeks that have closed"
          value={money(ledger.required)}
          hint={`(expected so far: ${money(ledger.weeklyAmount)} × the ${ledger.chai.weeks} week${
            ledger.chai.weeks === 1 ? '' : 's'
          } — not taken off the money he holds)`}
        />
        <CompactStat
          label={owed ? 'Owed' : 'Paid in'}
          value={money(owed ? ledger.arrears : ledger.paid)}
          hint={
            owed
              ? (ledger.chasedArrears ?? ledger.arrears) > 0
                ? '(closed weeks still unpaid)'
                : `(closed weeks still unpaid — not chased: he holds more than ${money(
                    ledger.moneyLimit
                  )})`
              : // Just what he has given: the weekly 1,400 is the minimum each closed week asks for,
                // not a pot, so there is nothing to call "extra" and nothing to keep a running total of.
                '(what he has given since the books opened)'
          }
          alert={owed && (ledger.chasedArrears ?? ledger.arrears) > 0}
        />
        <CompactStat
          label={`Tea — ${ledger.chai.weeks} week${ledger.chai.weeks === 1 ? '' : 's'}`}
          value={money(ledger.chai.due)}
          hint={`(deducted automatically, ${money(ledger.chai.perWeek)} a week)`}
        />
      </section>

      <p className="rounded-xl border border-rule bg-canvas px-4 py-3 text-xs leading-5 text-muted">
        {money(ledger.openingBalance)} carried in at week {data.week.cycleStartWeek} +{' '}
        {money(ledger.paid)} paid in since then − {money(ledger.chai.due)} tea
        {ledger.finesPaid > 0 ? <> − {money(ledger.finesPaid)} fines paid out of his money</> : null} ={' '}
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
          ` ${ledger.nillWeeksDueFine.length} closed week(s) had nothing paid in them (${ledger.nillWeeksDueFine
            .map((w) => 'W' + w)
            .join(', ')}) — the 50 fine under clause 7.5 has not been charged.`}
      </p>

      {/* =====================================================
          THE WORKING — the same figures as the tiles above, one
          step at a time, closed to a line until the treasurer asks
          for it. It lives just under the sentence that states the
          sum, because it is that sentence spelled out.
      ====================================================== */}
      <LedgerWalk walk={data.walk} />

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)] lg:items-start">
        {/* Add a log — the one write the treasurer needs */}
        <AddLogForm
          amount={amount}
          amountRef={amountRef}
          busy={busy}
          coverArrears={coverArrears}
          data={data}
          date={date}
          description={description}
          duplicate={duplicate}
          firstShortWeek={firstShortWeek}
          kind={kind}
          ledger={ledger}
          method={method}
          note={note}
          pasted={pasted}
          selectedWeek={selectedWeek}
          setAmount={setAmount}
          setDate={setDate}
          setDescription={setDescription}
          setDuplicate={setDuplicate}
          setKind={setKind}
          setMethod={setMethod}
          setNote={setNote}
          setTargetWeek={setTargetWeek}
          submit={submit}
          weekDue={weekDue}
        />

        <LedgerEntries
          data={data}
          expenses={expenses}
          ledger={ledger}
          logs={logs}
          member={member}
          setDeleting={setDeleting}
          setShowWeeks={setShowWeeks}
          showWeeks={showWeeks}
          teaFund={teaFund}
          week={week}
        />
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


