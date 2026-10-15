import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate } from '../utils/format';
import { blobErrorMessage } from '../utils/blobError';
import { sourceLabel } from '../utils/finePayment';
import Loader from '../components/shared/Loader';
import ErrorState from '../components/shared/ErrorState';
import BackLink from '../components/shared/BackLink';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import IssueFineForm from '../components/members/IssueFineForm';
import WhoOwesWhat from '../components/fines/WhoOwesWhat';
import PayFinesModal from '../components/fines/PayFinesModal';
import PaymentsToCheck from '../components/fines/PaymentsToCheck';

// Fines, in one place.
//
// Issue a fine, collect a payment, take one back, void a wrong one, see who owes what and hand
// the committee a document. Every one of those used to be on one long page: the form to issue a
// fine sat above the list, and Pay opened its form at the top whatever row it was pressed on, so
// on a phone it looked as though nothing had happened.
//
// So it is a desk with tabs, and the one job that matters most — collecting a payment — is a
// button at the top that opens a dialog over whatever you are looking at:
//
//   Who owes     the members in debt, with Pay on every row
//   All fines    every fine, filtered and searched, each with its payment history
//   Issue a fine find the member, then the form
//   To check     earlier payments that still need somebody to say how they were paid
//
// The tab is in the address (?tab=), so Back works and a link can land on the right one.
//
// Roles: the admin and the super admin, which is exactly who may issue, settle and void a fine in
// the API. The treasurer records the payments that clear fines through the ledger instead; the
// disciplinary officer has his own screen, narrowed to his own category of fines.
const TABS = [
  { id: 'owes', label: 'Who owes' },
  { id: 'all', label: 'All fines' },
  { id: 'issue', label: 'Issue a fine' },
  { id: 'check', label: 'To check' },
];

const FILTERS = [
  { value: 'pending', label: 'Owed' },
  { value: 'settled', label: 'Cleared' },
  { value: 'all', label: 'All' },
  { value: 'voided', label: 'Voided' },
];

const PAGE_SIZE = 25;

export default function Fines() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = TABS.some((t) => t.id === requested) ? requested : 'owes';

  const [summary, setSummary] = useState(null);
  const [list, setList] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberTotal, setMemberTotal] = useState(0);
  const [toCheck, setToCheck] = useState(0);
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Issue a fine: find the member, then the form — the same two steps as the discipline screen,
  // because it is the same job.
  const [memberSearch, setMemberSearch] = useState('');
  const [target, setTarget] = useState(null);

  // The payment dialog: closed (null), or open for a member and, optionally, one of his fines.
  const [paying, setPaying] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [undoing, setUndoing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(null);

  function goTo(next) {
    setParams(next === 'owes' ? {} : { tab: next });
  }

  const loadSummary = useCallback(async () => {
    const res = await api.get('/api/fines/summary');
    setSummary(res.data);
    return res.data;
  }, []);

  const loadList = useCallback(async (which = 'pending', whichPage = 1, term = '') => {
    const res = await api.get('/api/fines', {
      params: { status: which, page: whichPage, limit: PAGE_SIZE, ...(term ? { search: term } : {}) },
    });
    setList(res.data);
    return res.data;
  }, []);

  const loadToCheck = useCallback(async () => {
    try {
      const res = await api.get('/api/fines/payments/to-check');
      setToCheck(res.data.payments.length);
    } catch {
      // Non-fatal: the tab simply does not show a count.
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoadError('');
    try {
      await Promise.all([loadSummary(), loadList('pending', 1), loadToCheck()]);
    } catch (err) {
      setLoadError(apiMessage(err, 'Could not load the fines'));
    } finally {
      setLoading(false);
    }
  }, [loadSummary, loadList, loadToCheck]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // The issue tab's member picker asks the server for the few that match what is typed, rather
  // than loading the whole register and filtering it here: a list capped at the first five
  // hundred would quietly leave out everybody after them. Only while that tab is open.
  useEffect(() => {
    if (tab !== 'issue') return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get('/api/members', {
          params: { status: 'active', limit: 40, search: memberSearch.trim() || undefined },
        })
        .then((res) => {
          if (!cancelled) {
            setMembers(res.data.members);
            setMemberTotal(res.data.total ?? res.data.members.length);
          }
        })
        .catch(() => {
          // Non-fatal: the figures, the list and the report all still work.
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, memberSearch]);

  // Typing in the search box asks the server a moment after the last key, so a member is found
  // among every fine on the record and not only the page that happens to be loaded.
  useEffect(() => {
    if (loading) return undefined;
    const timer = setTimeout(() => {
      setPage(1);
      loadList(status, 1, search.trim()).catch((err) =>
        toast(apiMessage(err, 'Could not search the fines'), 'error')
      );
    }, 300);
    return () => clearTimeout(timer);
    // `status` and `toast` are deliberately left out: choosing a filter loads it directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const owingMembers = useMemo(
    () => (summary?.byMember || []).filter((m) => Number(m.outstanding) > 0),
    [summary]
  );

  async function changeFilter(next) {
    setStatus(next);
    setPage(1);
    try {
      await loadList(next, 1, search.trim());
    } catch (err) {
      toast(apiMessage(err, 'Could not load that list'), 'error');
    }
  }

  async function changePage(next) {
    setPage(next);
    try {
      await loadList(status, next, search.trim());
    } catch (err) {
      toast(apiMessage(err, 'Could not load that page'), 'error');
    }
  }

  // Everything reloads after any write: settling a fine moves the totals as well as the row, and
  // a screen whose tiles disagreed with its list would be worse than no tiles.
  const refresh = useCallback(async () => {
    try {
      await Promise.all([loadSummary(), loadList(status, page, search.trim()), loadToCheck()]);
    } catch (err) {
      toast(apiMessage(err, 'Could not refresh the figures'), 'error');
    }
  }, [loadSummary, loadList, loadToCheck, status, page, search, toast]);

  async function confirmVoid() {
    if (!voiding) return;
    setBusy(true);
    try {
      const res = await api.delete(`/api/fines/${voiding.id}`);
      const back = Number(res.data?.returnedToBalance) || 0;
      const cash = Number(res.data?.cashReceived) || 0;
      toast(
        `Fine voided — it is no longer owed, and it stays on the record.${
          back > 0 ? ` ${money(back)} went back to his balance.` : ''
        }${cash > 0 ? ` ${money(cash)} he paid in cash is still on the record.` : ''}`
      );
      setVoiding(null);
      await refresh();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmUndo() {
    if (!undoing) return;
    setBusy(true);
    try {
      const res = await api.post(`/api/fines/${undoing.fine.id}/payments/${undoing.payment.index}/undo`, {
        amount: undoing.payment.amount,
      });
      const back = Number(res.data?.returnedToBalance) || 0;
      toast(
        `Payment of ${money(res.data?.undone)} taken back — the fine is owed again.${
          back > 0 ? ` ${money(back)} went back to his balance.` : ''
        }`
      );
      setUndoing(null);
      await refresh();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Fetched as a blob rather than linked directly: a bare link that hits an error shows raw JSON
  // in the browser instead of the app's own message.
  async function exportFile(format) {
    setExporting(format);
    try {
      const res = await api.get('/api/fines/export', {
        params: { format },
        responseType: 'blob',
      });
      const objectUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = format === 'xlsx' ? 'fines-group.xlsx' : 'fines-group.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      toast(await blobErrorMessage(err, 'Could not export the fines report'), 'error');
    } finally {
      setExporting(null);
    }
  }

  if (loading) return <Loader />;

  if (loadError && !summary) {
    return (
      <div className="space-y-4">
        <BackLink to="/admin/dashboard" className="mb-2">
          Dashboard
        </BackLink>
        <ErrorState message={loadError} onRetry={loadAll} />
      </div>
    );
  }

  const totals = summary?.totals || {};
  const owed = Number(totals.outstanding) || 0;

  return (
    <div className="space-y-4">
      <header>
        <BackLink to="/admin/dashboard" className="mb-2">
          Dashboard
        </BackLink>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Money owed</p>
            <h1 className="mt-1 text-2xl font-bold">Fines</h1>
            <p className="mt-1 max-w-lg text-sm text-muted">
              Issue a fine, record what has been paid, and see who still owes. Members are emailed when a fine
              is issued against them and when a payment is recorded.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPaying({ memberId: null, fineId: null })}
              className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white"
            >
              Record a payment
            </button>
            {/* The same figures as a document: the page for a meeting, or the workbook the office
                can sort. Both come off the records on this screen. */}
            <button
              type="button"
              onClick={() => exportFile('pdf')}
              disabled={!!exporting}
              className="min-h-11 rounded-lg border border-rule bg-surface px-3 text-sm font-medium disabled:opacity-60"
            >
              {exporting === 'pdf' ? 'Building…' : 'PDF'}
            </button>
            <button
              type="button"
              onClick={() => exportFile('xlsx')}
              disabled={!!exporting}
              className="min-h-11 rounded-lg border border-rule bg-surface px-3 text-sm font-medium disabled:opacity-60"
            >
              {exporting === 'xlsx' ? 'Building…' : 'Excel'}
            </button>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Still owed"
          value={money(owed)}
          hint={
            totals.pendingCount
              ? `${totals.pendingCount} ${totals.pendingCount === 1 ? 'fine' : 'fines'} not cleared`
              : 'Every fine issued has been cleared'
          }
          alert={owed > 0}
        />
        <Stat
          label="Paid off"
          value={money(totals.cleared)}
          hint={`${totals.clearedCount || 0} of ${totals.count || 0} fines cleared`}
          accent
        />
        <Stat
          label="Members owing"
          value={String(totals.membersOwing || 0)}
          hint={
            totals.oldestUnpaid
              ? `Oldest unpaid fine since ${shortDate(totals.oldestUnpaid)}`
              : 'Nobody is behind'
          }
        />
      </section>

      {/* Earlier payments waiting for somebody to say how they were made. Shown on every tab
          until they are sorted, because until then they move nothing on a member's balance. */}
      {toCheck > 0 && tab !== 'check' && (
        <button
          type="button"
          onClick={() => goTo('check')}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-left"
        >
          <span className="min-w-0 text-sm">
            <span className="font-semibold">
              {toCheck} earlier {toCheck === 1 ? 'payment needs' : 'payments need'} checking.
            </span>{' '}
            <span className="text-muted">Say whether each was cash or taken from the member’s balance.</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-primary">Check now</span>
        </button>
      )}

      <nav aria-label="Fines sections" className="-mx-1 overflow-x-auto px-1">
        <div role="tablist" className="flex min-w-max gap-1 border-b border-rule">
          {TABS.filter((t) => t.id !== 'check' || toCheck > 0 || tab === 'check').map((t) => {
            const active = tab === t.id;
            const count = t.id === 'owes' ? owingMembers.length : t.id === 'check' ? toCheck : null;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`fines-tab-${t.id}`}
                aria-selected={active}
                aria-controls="fines-panel"
                onClick={() => goTo(t.id)}
                className={`-mb-px min-h-12 whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${
                  active ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {t.label}
                {count ? (
                  <span
                    className={`ml-1.5 rounded-full px-2 py-0.5 text-[11px] ${
                      t.id === 'check' ? 'bg-accent/15 text-accent' : 'bg-canvas text-muted'
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div id="fines-panel" role="tabpanel" aria-labelledby={`fines-tab-${tab}`} className="space-y-4">
        {/* ------------------------------------------------------------ who owes */}
        {tab === 'owes' && (
          <section className="min-w-0 rounded-xl border border-rule bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold">Who owes what</h2>
            <WhoOwesWhat
              members={summary?.byMember || []}
              totals={summary?.totals}
              onPay={(row) => setPaying({ memberId: row.memberId, fineId: null })}
            />
          </section>
        )}

        {/* ------------------------------------------------------------ all fines */}
        {tab === 'all' && (
          <section className="overflow-hidden rounded-xl border border-rule bg-surface">
            <div className="space-y-3 border-b border-rule px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">
                  {list?.scopeLabel || 'Fines'}
                  {list ? ` (${list.total})` : ''}
                </h2>
                <div className="flex flex-wrap gap-1">
                  {FILTERS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => changeFilter(f.value)}
                      aria-pressed={status === f.value}
                      className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${
                        status === f.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-rule text-muted'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search a member by name, phone or reg number"
                aria-label="Search fines by member"
                className="h-11 w-full rounded-xl border border-rule bg-canvas px-4 text-sm"
              />
            </div>

            {!list ? (
              <p className="px-5 py-8 text-center text-sm text-muted">Loading…</p>
            ) : list.fines.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">
                {search.trim()
                  ? `No fine matches “${search.trim()}”.`
                  : status === 'pending'
                    ? 'Nothing is owed. Every fine issued has been cleared.'
                    : status === 'voided'
                      ? 'No fine has been voided.'
                      : 'No fines on this list.'}
              </p>
            ) : (
              <ul>
                {list.fines.map((f) => (
                  <FineRow
                    key={f.id}
                    fine={f}
                    onPay={() => setPaying({ memberId: f.memberId, fineId: f.id })}
                    onVoid={() => setVoiding(f)}
                    onUndo={(payment) => setUndoing({ fine: f, payment })}
                  />
                ))}
              </ul>
            )}

            {list && list.pages > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-rule px-4 py-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => changePage(page - 1)}
                  className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium disabled:opacity-50"
                >
                  Previous
                </button>
                <p className="text-xs text-muted">
                  Page {page} of {list.pages}
                </p>
                <button
                  type="button"
                  disabled={page >= list.pages}
                  onClick={() => changePage(page + 1)}
                  className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </section>
        )}

        {/* ------------------------------------------------------------ issue a fine */}
        {tab === 'issue' && (
          <section className="rounded-xl border border-rule bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Issue a fine</h2>
              <p className="text-xs text-muted">The member is emailed as soon as it is recorded.</p>
            </div>

            {target ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-canvas px-3 py-2">
                  <p className="min-w-0 text-sm">
                    <span className="font-medium">{target.name}</span>
                    <span className="text-muted">
                      {target.regNumber ? ` · ${target.regNumber}` : ''}
                      {target.phone ? ` · ${target.phone}` : ''}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setTarget(null)}
                    className="-my-1 min-h-11 rounded-lg px-2 text-sm font-medium text-primary"
                  >
                    Change member
                  </button>
                </div>
                <IssueFineForm
                  memberId={target._id}
                  onIssued={() => {
                    setTarget(null);
                    setMemberSearch('');
                    refresh();
                    goTo('owes');
                  }}
                  onCancel={() => setTarget(null)}
                />
              </>
            ) : (
              <>
                <input
                  type="search"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Search a member by name, phone or reg no."
                  aria-label="Search members"
                  className="h-12 w-full rounded-xl border border-rule bg-canvas px-4 text-sm"
                />
                {members.length === 0 && !memberSearch.trim() ? (
                  <p className="mt-3 text-sm text-muted">
                    No active members to fine. Add them on{' '}
                    <Link to="/admin/members" className="text-primary underline">
                      Members
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="mt-3 max-h-96 overflow-y-auto overscroll-contain rounded-lg border border-rule">
                    {members.map((m) => (
                      <li key={m._id} className="border-b border-rule last:border-b-0">
                        <button
                          type="button"
                          onClick={() => setTarget(m)}
                          className="flex min-h-14 w-full items-center justify-between gap-3 px-3 text-left hover:bg-elevation"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{m.name}</span>
                            <span className="block truncate text-xs text-muted">
                              {m.regNumber ? `${m.regNumber} · ` : ''}
                              {m.phone}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-medium text-primary">Fine</span>
                        </button>
                      </li>
                    ))}
                    {members.length === 0 && (
                      <li className="px-3 py-6 text-center text-sm text-muted">No member matches that search.</li>
                    )}
                  </ul>
                )}
                {memberTotal > members.length && (
                  <p className="mt-2 text-xs text-muted">
                    Showing {members.length} of {memberTotal} members. Type a name, phone or reg number to narrow it.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {/* ------------------------------------------------------------ to check */}
        {tab === 'check' && <PaymentsToCheck onChanged={refresh} />}
      </div>

      {paying && (
        <PayFinesModal
          memberId={paying.memberId}
          fineId={paying.fineId}
          owingMembers={owingMembers}
          onClose={() => setPaying(null)}
          onPaid={refresh}
        />
      )}

      <ConfirmDialog
        open={!!voiding}
        title="Void this fine?"
        body={
          voiding
            ? `${voiding.memberName || 'This member'}: ${money(
                voiding.remaining
              )} outstanding on ${voiding.type || 'a fine'} will no longer be owed. Voiding says the fine should never have been issued — to record money that was actually paid, use Pay instead. If any of it was taken from his balance, it goes back to him.`
            : ''
        }
        confirmLabel="Void"
        danger
        busy={busy}
        onConfirm={confirmVoid}
        onCancel={() => setVoiding(null)}
      />

      <ConfirmDialog
        open={!!undoing}
        title="Take this payment back?"
        body={
          undoing
            ? `${money(undoing.payment.amount)} paid on ${shortDate(undoing.payment.date)} (${sourceLabel(
                undoing.payment.source
              ).toLowerCase()}) will be removed and the fine will be owed again by that amount.${
                undoing.payment.source === 'balance' ? ' The money goes back to his balance.' : ''
              } Use this for a payment keyed in by mistake.`
            : ''
        }
        confirmLabel="Take it back"
        danger
        busy={busy}
        onConfirm={confirmUndo}
        onCancel={() => setUndoing(null)}
      />
    </div>
  );
}

// One fine on the list: who, what for, what is left, and what can be done about it — with the
// payments made against it a tap away, so "has he paid?" is answered on the row.
function FineRow({ fine: f, onPay, onVoid, onUndo }) {
  const [open, setOpen] = useState(false);
  const payments = f.payments || [];
  // Only payments keyed in by hand can be taken back; one taken out of a contribution is undone
  // by deleting that contribution.
  const undoable = (p) => !f.voided && p.source !== 'contribution';

  return (
    <li className="border-b border-rule last:border-b-0">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-medium">
            {f.memberId ? (
              <Link to={`/admin/members/${f.memberId}`} className="hover:underline">
                {f.memberName || 'Member'}
              </Link>
            ) : (
              f.memberName || 'Member'
            )}
            {f.issuedBy ? <span className="font-normal text-muted"> · issued by {f.issuedBy}</span> : null}
          </p>
          <p className="text-xs text-muted">
            {f.type || 'Fine'}
            {f.reason ? ` · ${f.reason}` : ''} · {shortDate(f.date)}
          </p>
          <p className="amount mt-1 text-xs text-muted">
            {money(f.amount)} issued
            {f.voided ? ' · voided, not owed' : f.remaining > 0 ? '' : ' · cleared'}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <p
            className={`amount text-sm font-semibold ${
              f.voided ? 'text-muted line-through' : f.remaining > 0 ? 'text-alert' : 'text-primary'
            }`}
          >
            {f.remaining > 0 || f.voided ? money(f.remaining) : 'Cleared'}
          </p>
          {!f.voided && f.remaining > 0 && <p className="text-[11px] text-muted">still owed</p>}
        </div>

        <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
          {!f.voided && f.remaining > 0 && (
            <button
              type="button"
              onClick={onPay}
              className="min-h-11 rounded-lg border border-primary px-4 text-sm font-semibold text-primary hover:bg-primary/5"
            >
              Pay
            </button>
          )}
          {payments.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted hover:text-ink"
            >
              Payments ({payments.length}) {open ? '▴' : '▾'}
            </button>
          )}
          {!f.voided && (
            <button
              type="button"
              onClick={onVoid}
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted hover:text-alert"
            >
              Void
            </button>
          )}
        </div>
      </div>

      {open && payments.length > 0 && (
        <ul className="space-y-1 border-t border-rule bg-canvas px-4 py-2">
          {payments.map((p) => (
            <li key={p.index} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span className="min-w-0 text-xs">
                <span className="amount font-medium">{money(p.amount)}</span>
                <span className="text-muted">
                  {' '}
                  · {shortDate(p.date)} · {sourceLabel(p.source)}
                </span>
              </span>
              {undoable(p) && (
                <button
                  type="button"
                  onClick={() => onUndo(p)}
                  className="min-h-11 rounded-lg px-2 text-xs font-medium text-muted hover:text-alert"
                >
                  Take back
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// One figure with its explanation, the same shape the spending screen uses: these are the group's
// own numbers and an office should be able to defend any of them.
function Stat({ label, value, hint, accent, alert }) {
  return (
    <div className="rounded-xl border border-rule bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className={`amount mt-1 text-lg font-bold ${alert ? 'text-alert' : accent ? 'text-primary' : ''}`}>
        {value}
      </p>
      {hint && <p className="amount mt-1 text-[11px] leading-4 text-muted">{hint}</p>}
    </div>
  );
}
