import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate, todayISO, isoDateOf } from '../utils/format';
import { blobErrorMessage } from '../utils/blobError';
import Loader from '../components/shared/Loader';
import ErrorState from '../components/shared/ErrorState';
import BackLink from '../components/shared/BackLink';
import ConfirmDialog from '../components/shared/ConfirmDialog';

// Money leaving the funds, in one place.
//
// Until now an expense could only be logged from a member's own page, where it read as
// something done to him rather than something done with the group's money, and there
// was nowhere to see all of them together or hand anyone a record. This is that
// screen: the form that records spending, every entry on the books, and the report
// that comes off it. Each entry is deducted from what the funds hold the moment it is
// saved, which is why the three figures at the top are the ones to read first.
//
// Roles: admin and treasurer (and the super admin), the same people who may log money
// in — the API refuses anyone else.

// The empty form, built fresh each time it is needed: a screen left open overnight
// would otherwise still be offering yesterday as "today", and the date box holds the
// one figure in this form nobody expects to have to correct.
function emptyForm(date = todayISO()) {
  return {
    typeId: '',
    amount: '',
    date,
    description: '',
    reference: '',
    note: '',
  };
}

// One fund, as the picker writes it: what it is called, what it holds, and — for a fund
// that has been spent past what it held — that it is overdrawn rather than showing a
// negative "holds". A loan fund is named as one, because money paid out of it is owed
// back rather than spent.
function fundLabel(fund) {
  const balance = Number(fund.balance) || 0;
  const held = balance < 0 ? `overdrawn by ${money(-balance)}` : `holds ${money(balance)}`;
  return `${fund.name} — ${held}${fund.isRecoverable ? ' (loan fund)' : ''}`;
}

export default function Expenses() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(() => emptyForm());
  // The expense being corrected, when the form is being used to fix one instead of
  // recording one. Held as an id so the list underneath stays the source of truth.
  const [editingId, setEditingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [exporting, setExporting] = useState(null);
  const amountRef = useRef(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get('/api/expenses/summary');
      setData(res.data);
      return res.data;
    } catch (err) {
      setLoadError(apiMessage(err, 'Could not load the fund spending'));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const funds = data?.funds || [];
  const expenses = data?.expenses || [];

  // The funds ordered by what they hold. An expense almost always comes out of the pot
  // holding the money, and a fund nothing has been collected into yet is not a choice
  // worth standing beside it as an equal — so the ones with money come first, and the
  // empty ones are grouped under their own heading in the picker.
  const fundsByBalance = useMemo(
    () => [...funds].sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0)),
    [funds]
  );
  const inCredit = useMemo(
    () => fundsByBalance.filter((f) => (Number(f.balance) || 0) > 0),
    [fundsByBalance]
  );
  const empty = useMemo(
    () => fundsByBalance.filter((f) => (Number(f.balance) || 0) <= 0),
    [fundsByBalance]
  );

  // The fund the form will spend from: whatever was picked, or — on a fresh form — the
  // fullest fund, because that is where the group's money actually is. Chosen here
  // rather than in an effect so a reload after saving never moves the selection out from
  // under the treasurer.
  const selectedFund = useMemo(
    () => funds.find((f) => f.id === form.typeId) || inCredit[0] || fundsByBalance[0] || null,
    [funds, fundsByBalance, inCredit, form.typeId]
  );

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function startEdit(expense) {
    setEditingId(expense.id);
    setForm({
      typeId: expense.fundId || '',
      amount: String(expense.amount ?? ''),
      date: expense.date ? isoDateOf(expense.date) : todayISO(),
      description: expense.description || '',
      reference: expense.reference || '',
      note: expense.note || '',
    });
    amountRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId('');
    setForm({ ...emptyForm(), typeId: selectedFund?.id || '' });
  }

  async function submit(e) {
    e.preventDefault();
    const n = Number(String(form.amount).replace(/,/g, ''));
    if (!selectedFund || !form.typeId) {
      toast('Choose the fund this was spent from', 'error');
      return;
    }
    if (!Number.isFinite(n) || n <= 0) {
      toast('Enter an amount greater than zero', 'error');
      return;
    }
    const body = {
      typeId: form.typeId,
      amount: n,
      date: form.date || todayISO(),
      description: form.description.trim(),
      reference: form.reference.trim(),
      note: form.note.trim(),
    };

    setBusy(true);
    try {
      if (editingId) {
        await api.patch(`/api/expenses/${editingId}`, body);
        toast('Expense corrected — the change is in the audit trail');
      } else {
        await api.post('/api/expenses', body);
        toast(
          `${money(n)} recorded against ${selectedFund.name}${
            selectedFund.balance - n < 0 ? ' — that fund is now overdrawn' : ''
          }`
        );
      }
      setEditingId('');
      setForm({ ...emptyForm(body.date), typeId: form.typeId });
      await load();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/api/expenses/${deleting.id}`);
      toast('Expense removed — the money is back in the fund');
      setDeleting(null);
      if (editingId === deleting.id) cancelEdit();
      await load();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Fetched as a blob rather than linked directly: a bare link that hits an error
  // shows raw JSON in the browser instead of the app's own message.
  async function exportFile(format) {
    setExporting(format);
    try {
      const res = await api.get('/api/expenses/export', {
        params: { format },
        responseType: 'blob',
      });
      const objectUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = format === 'xlsx' ? 'expenses.xlsx' : 'expenses.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      toast(await blobErrorMessage(err, 'Could not export the spending report'), 'error');
    } finally {
      setExporting(null);
    }
  }

  if (loading) return <Loader />;

  if (loadError && !data) {
    return (
      <div className="space-y-4">
        <BackLink to="/admin/finance" className="mb-2">
          Finance
        </BackLink>
        <ErrorState message={loadError} onRetry={load} />
      </div>
    );
  }

  const holding = data?.money || { totalContributed: 0, totalExpenses: 0, netBalance: 0 };
  // The group's own funds added up, spending already off them. Named separately from
  // "the group holds now" (which also carries the members' own carried-in money): this
  // is the figure a meeting means by "what does the fund hold".
  const groupFund = data?.groupFund || { in: 0, spent: 0, onLoan: 0, holds: 0 };
  const totalSpent = data?.summary?.total || 0;
  const byFund = data?.byFund || [];
  const byMonth = data?.byMonth || [];
  const editing = expenses.find((x) => x.id === editingId) || null;

  return (
    <div className="space-y-4">
      <header>
        <BackLink to="/admin/finance" className="mb-2">
          Finance
        </BackLink>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Money out</p>
            <h1 className="mt-1 text-2xl font-bold">Fund spending</h1>
          </div>
          {/* The record as a document: the page for a meeting, or the workbook the
              office can sort. Both come off the same figures as this screen. */}
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

      {/* The four figures in the order they are worked out, ending in what the group's
          own funds hold now: everything that came into them, less what has been spent
          from them (and, named separately, less anything out on loan, which is still
          owed back rather than gone). */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Money in, all time"
          value={money(holding.totalContributed)}
          hint="Members and funds, carry-in included"
        />
        <Stat
          label="Group funds hold"
          value={money(groupFund.holds)}
          hint={`${money(groupFund.in)} came in − ${money(groupFund.spent)} spent${
            groupFund.onLoan > 0 ? ` − ${money(groupFund.onLoan)} out on loan` : ''
          }`}
          accent
        />
        <Stat
          label="Spent out of the funds"
          value={`− ${money(holding.totalExpenses)}`}
          hint="Deducted from the funds, and from the total. Loans and advances are not — that money is owed back"
          alert
        />
        <Stat
          label="The group holds now"
          value={money(holding.netBalance)}
          hint="Everything in (members' money included), less everything spent"
        />
      </section>

      {/* Recording what was spent. Two roles may do this — admin and treasurer — and
          the API refuses anyone else, so this form is safe to render on the page. */}
      <section className="rounded-xl border border-rule bg-surface p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">
            {editing
              ? `Correcting ${money(editing.amount)} on ${shortDate(editing.date)}`
              : 'Record an expense'}
          </h2>
          {editing && (
            <button
              type="button"
              onClick={cancelEdit}
              className="-my-1 min-h-11 rounded-lg px-2 text-sm font-medium text-primary"
            >
              Cancel
            </button>
          )}
        </div>

        {funds.length === 0 ? (
          <p className="rounded-lg border border-dashed border-rule px-4 py-6 text-center text-sm text-muted">
            No fund is set up to be spent from yet. Mark one on{' '}
            <Link to="/admin/finance/setup" className="text-primary underline">
              Finance → Setup
            </Link>{' '}
            first.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="expense-fund" className="mb-1 block text-xs font-medium">
                  Spent from
                </label>
                <select
                  id="expense-fund"
                  value={form.typeId || selectedFund?.id || ''}
                  onChange={(e) => set('typeId', e.target.value)}
                  className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
                >
                  {/* Ordered by what they hold, so the pot the money is actually in comes
                      first and the funds nothing has been collected into yet sit under a
                      heading of their own instead of standing beside it as equals. */}
                  {inCredit.map((f) => (
                    <option key={f.id} value={f.id}>
                      {fundLabel(f)}
                    </option>
                  ))}
                  {empty.length > 0 && (
                    <optgroup label="Nothing collected into these yet">
                      {empty.map((f) => (
                        <option key={f.id} value={f.id}>
                          {fundLabel(f)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <p className="amount mt-1 text-[11px] leading-4 text-muted">
                  The group's funds hold {money(groupFund.holds)} altogether. Spending comes off
                  the fund picked here.
                </p>
              </div>
              <div>
                <label htmlFor="expense-amount" className="mb-1 block text-xs font-medium">
                  Amount
                </label>
                <input
                  id="expense-amount"
                  ref={amountRef}
                  type="text"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => set('amount', e.target.value)}
                  placeholder="0"
                  className="amount h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-base font-semibold"
                />
              </div>
              <div>
                <label htmlFor="expense-date" className="mb-1 block text-xs font-medium">
                  Date
                </label>
                <input
                  id="expense-date"
                  type="date"
                  max={todayISO()}
                  value={form.date}
                  onChange={(e) => set('date', e.target.value)}
                  className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="expense-description" className="mb-1 block text-xs font-medium">
                  What it was for
                </label>
                <input
                  id="expense-description"
                  type="text"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="e.g. Tea and mandazi for the meeting"
                  className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="expense-reference" className="mb-1 block text-xs font-medium">
                  Voucher or receipt no.{' '}
                  <span className="font-normal text-muted">— what the paperwork says</span>
                </label>
                <input
                  id="expense-reference"
                  type="text"
                  value={form.reference}
                  onChange={(e) => set('reference', e.target.value)}
                  placeholder="e.g. VOUCHER 014"
                  className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="expense-note" className="mb-1 block text-xs font-medium">
                Note{' '}
                <span className="font-normal text-muted">
                  — paste the M-Pesa message or say who was paid
                </span>
              </label>
              <textarea
                id="expense-note"
                rows={3}
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
                placeholder="QDE7X1LMN Confirmed. Ksh500.00 paid to MAMA GRACE SUPPLIERS on 17/9/26."
                className="w-full rounded-lg border border-rule bg-canvas px-3 py-2 text-sm leading-5"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="min-h-12 w-full rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Saving…' : editing ? 'Save the correction' : 'Record the expense'}
            </button>
          </form>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Where the money in each fund has gone. A fund that no longer exists still
            appears if it has spending against it, so nothing vanishes from the total. */}
        <section className="overflow-hidden rounded-xl border border-rule bg-surface">
          <h2 className="border-b border-rule px-4 py-3 text-sm font-semibold">
            How each fund stands
          </h2>
          {byFund.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">Nothing spent yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-[11px] uppercase tracking-widest text-muted">
                  <th className="px-4 py-2 font-semibold">Fund</th>
                  <th className="amount px-2 py-2 text-right font-semibold">In</th>
                  <th className="amount px-2 py-2 text-right font-semibold">Out</th>
                  <th className="amount px-4 py-2 text-right font-semibold">Holds</th>
                </tr>
              </thead>
              <tbody>
                {byFund.map((f) => (
                  <tr key={f.name} className="border-b border-rule last:border-b-0">
                    <td className="px-4 py-2">
                      <span className="font-medium">{f.name}</span>
                      {f.advances > 0 && (
                        <span className="block text-[11px] text-muted">
                          {money(f.advances)} of that is a loan, still owed back
                        </span>
                      )}
                    </td>
                    <td className="amount px-2 py-2 text-right">
                      {money(f.contributed + f.carriedIn + f.derived)}
                    </td>
                    <td className="amount px-2 py-2 text-right text-alert">{money(f.spent)}</td>
                    <td className="amount px-4 py-2 text-right font-semibold">{money(f.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-rule bg-surface">
          <h2 className="border-b border-rule px-4 py-3 text-sm font-semibold">
            Spending by month
          </h2>
          {byMonth.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              Nothing spent yet, so there is nothing to chart.
            </p>
          ) : (
            <ul>
              {byMonth.map((m) => (
                <li
                  key={m.month}
                  className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5 text-sm last:border-b-0"
                >
                  <span>{monthLabel(m.month)}</span>
                  <span className="text-xs text-muted">
                    {m.count} {m.count === 1 ? 'entry' : 'entries'}
                  </span>
                  <span className="amount font-semibold text-alert">{money(m.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>


      {/* Every entry, newest first: the record itself, with what it was for and the
          voucher it is backed by, and the two ways of correcting one. */}
      <section className="overflow-hidden rounded-xl border border-rule bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <h2 className="text-sm font-semibold">Every expense ({expenses.length})</h2>
          <p className="amount text-sm font-semibold text-alert">
            {money(totalSpent)} spent in total
          </p>
        </div>

        {expenses.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            Nothing has been spent from the funds yet.
          </p>
        ) : (
          <ul>
            {expenses.map((x) => (
              <li
                key={x.id}
                className={`flex items-start gap-3 border-b border-rule px-4 py-3 last:border-b-0 ${
                  editingId === x.id ? 'bg-primary/5' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {x.description || 'Expense'}
                    <span className="text-muted">
                      {' · '}
                      {x.fund} · {shortDate(x.date)}
                      {x.reference ? ` · ${x.reference}` : ''}
                    </span>
                  </p>
                  {x.note && (
                    <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-canvas px-3 py-2 text-xs leading-5 text-muted">
                      {x.note}
                    </p>
                  )}
                  {x.loggedBy && (
                    <p className="mt-1 text-[11px] text-muted">Logged by {x.loggedBy}</p>
                  )}
                </div>
                <p className="amount shrink-0 font-semibold text-alert">{money(x.amount)}</p>
                <div className="flex shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(x)}
                    aria-label={`Correct the expense of ${money(x.amount)}`}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-primary"
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(x)}
                    aria-label={`Delete the expense of ${money(x.amount)}`}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-alert"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!deleting}
        title="Delete this expense?"
        body={
          deleting
            ? `${deleting.description || 'Expense'} — ${money(deleting.amount)} on ${shortDate(
                deleting.date
              )}. The money goes back into the fund, and the record stays in the audit trail.`
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

// One figure with its explanation, the same shape the member's page uses: these are
// the group's own numbers and a treasurer should be able to defend any of them.
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

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM' as the group writes a month. A fixed list rather than a locale call, so
// the label is the same on every device.
function monthLabel(key) {
  const [year, month] = String(key).split('-');
  return `${MONTH_SHORT[Number(month) - 1] || month} ${year}`;
}

// Inline SVG, no icon library — the same pencil-and-bin pair the ledger rows use.
function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

