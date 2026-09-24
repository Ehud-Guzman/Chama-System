import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate } from '../utils/format';
import { blobErrorMessage } from '../utils/blobError';
import Loader from '../components/shared/Loader';
import ErrorState from '../components/shared/ErrorState';
import BackLink from '../components/shared/BackLink';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import IssueFineForm from '../components/members/IssueFineForm';
import SettleFineForm from '../components/members/SettleFineForm';
import WhoOwesWhat from '../components/fines/WhoOwesWhat';

// Fines, in one place.
//
// Issue a fine, collect a payment, void a wrong one, see who owes what and hand the
// committee a document — every one of those operations already existed, but they were
// scattered: the debt list lived on Reports → Fines, and issuing, paying and voiding
// were only reachable from inside one member's record. Working a meeting's list of
// fines meant opening a member, going back, opening the next one.
//
// So this is the office's own screen for them, and it works in the order a meeting
// does: what is owed (the figures, then the list), then one payment or one new fine at
// a time, then the record as a PDF or a workbook.
//
// Roles: the admin and the super admin, which is exactly who may issue, settle and
// void a fine in the API. The treasurer records the payments that clear fines through
// the ledger instead; the disciplinary officer has his own screen, narrowed to his own
// category of fines.
const FILTERS = [
  { value: 'pending', label: 'Owed' },
  { value: 'settled', label: 'Cleared' },
  { value: 'all', label: 'All' },
  { value: 'voided', label: 'Voided' },
];

const PAGE_SIZE = 25;

export default function Fines() {
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState(null);
  const [members, setMembers] = useState([]);
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Issue a fine: find the member, then the form — the same two steps as the
  // discipline screen, because it is the same job.
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState(null);

  const [settling, setSettling] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(null);

  const loadSummary = useCallback(async () => {
    const res = await api.get('/api/fines/summary');
    setSummary(res.data);
    return res.data;
  }, []);

  const loadList = useCallback(async (which = 'pending', whichPage = 1) => {
    const res = await api.get('/api/fines', {
      params: { status: which, page: whichPage, limit: PAGE_SIZE },
    });
    setList(res.data);
    return res.data;
  }, []);

  const loadAll = useCallback(async () => {
    setLoadError('');
    try {
      await Promise.all([loadSummary(), loadList('pending', 1)]);
    } catch (err) {
      setLoadError(apiMessage(err, 'Could not load the fines'));
    } finally {
      setLoading(false);
    }
  }, [loadSummary, loadList]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    // The member register, so this page can offer a name to fine. Capped at 500 like
    // every other picker in the app.
    api
      .get('/api/members', { params: { status: 'active', limit: 500 } })
      .then((res) => setMembers(res.data.members))
      .catch(() => {
        // Non-fatal: the figures, the list and the report all still work.
      });
  }, []);

  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return members.slice(0, 40);
    return members
      .filter(
        (m) =>
          m.name.toLowerCase().includes(term) ||
          String(m.phone || '').includes(term) ||
          String(m.regNumber || '').toLowerCase().includes(term)
      )
      .slice(0, 40);
  }, [members, search]);

  async function changeFilter(next) {
    setStatus(next);
    setPage(1);
    try {
      await loadList(next, 1);
    } catch (err) {
      toast(apiMessage(err, 'Could not load that list'), 'error');
    }
  }

  async function changePage(next) {
    setPage(next);
    try {
      await loadList(status, next);
    } catch (err) {
      toast(apiMessage(err, 'Could not load that page'), 'error');
    }
  }

  // Both halves reload after any write: settling a fine moves the totals as well as the
  // row, and a screen whose tiles disagreed with its list would be worse than no tiles.
  async function refresh() {
    try {
      await Promise.all([loadSummary(), loadList(status, page)]);
    } catch (err) {
      toast(apiMessage(err, 'Could not refresh the figures'), 'error');
    }
  }

  async function confirmVoid() {
    if (!voiding) return;
    setBusy(true);
    try {
      await api.delete(`/api/fines/${voiding.id}`);
      toast('Fine voided — it is no longer owed, and it stays on the record');
      setVoiding(null);
      await refresh();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Fetched as a blob rather than linked directly: a bare link that hits an error shows
  // raw JSON in the browser instead of the app's own message.
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
              Issue a fine, record what has been paid, and see who still owes. Members are
              emailed when a fine is issued against them and when a payment clears one.
            </p>
          </div>
          {/* The same figures as a document: the page for a meeting, or the workbook the
              office can sort. Both come off the records on this screen. */}
          <div className="flex gap-2">
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

      {/* Issue a fine: the member first, because a fine belongs to somebody. The form
          below is the same one a member's own page opens, so the two cannot ask for
          different things. */}
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
                setSearch('');
                refresh();
              }}
              onCancel={() => setTarget(null)}
            />
          </>
        ) : (
          <>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a member by name, phone or reg no."
              aria-label="Search members"
              className="h-12 w-full rounded-xl border border-rule bg-canvas px-4 text-sm"
            />
            {members.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                No active members to fine. Add them on{' '}
                <Link to="/admin/members" className="text-primary underline">
                  Members
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-3 max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-rule">
                {filteredMembers.map((m) => (
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
                {filteredMembers.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-muted">
                    No member matches that search.
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </section>


      {/* Recording a payment, inline and above the list: the office has the member in
          front of it, and what he still owes is the one figure that has to be in view
          while the amount is typed. */}
      {settling && (
        <SettleFineForm
          fine={{
            // The list's own shape is {id, ...} because it is built for a screen; the
            // form was written for a fine document, so the id is renamed here rather
            // than in two places.
            _id: settling.id,
            remaining: settling.remaining,
            reason: settling.reason,
            typeId: { name: settling.type },
          }}
          onSettled={() => {
            setSettling(null);
            refresh();
          }}
          onCancel={() => setSettling(null)}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Every fine on the record, in the cut the office is working: owed, cleared,
            all, or what was voided. Paying and voiding happen on the row they belong
            to, so nobody has to open a member's whole record to settle one fine. */}
        <section className="overflow-hidden rounded-xl border border-rule bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
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

          {!list ? (
            <p className="px-5 py-8 text-center text-sm text-muted">Loading…</p>
          ) : list.fines.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              {status === 'pending'
                ? 'Nothing is owed. Every fine issued has been cleared.'
                : status === 'voided'
                  ? 'No fine has been voided.'
                  : 'No fines on this list.'}
            </p>
          ) : (
            <ul>
              {list.fines.map((f) => (
                <li
                  key={f.id}
                  className="flex items-start gap-3 border-b border-rule px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {f.memberName || 'Member'}
                      {f.issuedBy ? (
                        <span className="font-normal text-muted"> · issued by {f.issuedBy}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted">
                      {f.type || 'Fine'}
                      {f.reason ? ` · ${f.reason}` : ''} · {shortDate(f.date)}
                    </p>
                    <p className="amount mt-1 text-xs text-muted">
                      {money(f.amount)} issued
                      {f.voided
                        ? ' · voided, not owed'
                        : f.remaining > 0
                          ? ` · ${money(f.remaining)} still owed`
                          : ' · cleared'}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <p
                      className={`amount text-sm font-semibold ${
                        f.voided
                          ? 'text-muted line-through'
                          : f.remaining > 0
                            ? 'text-alert'
                            : 'text-primary'
                      }`}
                    >
                      {money(f.remaining)}
                    </p>
                    <div className="flex items-center">
                      {!f.voided && f.remaining > 0 && (
                        <button
                          type="button"
                          onClick={() => setSettling(f)}
                          className="min-h-11 rounded-lg border border-primary px-3 text-sm font-medium text-primary"
                        >
                          Pay
                        </button>
                      )}
                      {!f.voided && (
                        <button
                          type="button"
                          onClick={() => setVoiding(f)}
                          className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted hover:text-alert"
                        >
                          Void
                        </button>
                      )}
                      {f.memberId && (
                        <Link
                          to={`/admin/members/${f.memberId}`}
                          className="min-h-11 rounded-lg px-3 text-sm font-medium leading-[2.75rem] text-primary"
                        >
                          Record
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
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

        <section className="min-w-0 rounded-xl border border-rule bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold">Who owes what</h2>
          <WhoOwesWhat members={summary?.byMember || []} totals={summary?.totals} />
        </section>
      </div>

      <ConfirmDialog
        open={!!voiding}
        title="Void this fine?"
        body={
          voiding
            ? `${voiding.memberName || 'This member'}: ${money(
                voiding.remaining
              )} outstanding on ${voiding.type || 'a fine'} will no longer be owed. Voiding says the fine should never have been issued — to record money that was actually paid, use Pay instead.`
            : ''
        }
        confirmLabel="Void"
        danger
        busy={busy}
        onConfirm={confirmVoid}
        onCancel={() => setVoiding(null)}
      />
    </div>
  );
}

// One figure with its explanation, the same shape the spending screen uses: these are
// the group's own numbers and an office should be able to defend any of them.
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
      {hint && <p className="amount mt-1 text-[11px] leading-4 text-muted">{hint}</p>}
    </div>
  );
}

