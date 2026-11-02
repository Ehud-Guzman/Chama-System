import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate, todayISO, isoDateOf } from '../utils/format';
import { blobErrorMessage } from '../utils/blobError';
import Loader from '../components/shared/Loader';
import ErrorState from '../components/shared/ErrorState';
import BackLink from '../components/shared/BackLink';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import CompactStat from '../components/shared/CompactStat';
import ExpenseForm from './expenses/ExpenseForm';
import ExpenseSummaries from './expenses/ExpenseSummaries';
import ExpenseList from './expenses/ExpenseList';

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
    // Where the money comes from: a fund the group collects into, or the group's total
    // money — for what the group buys as a whole (land, a building), which has no fund
    // to charge.
    source: 'fund',
    typeId: '',
    amount: '',
    date,
    description: '',
    reference: '',
    approvalRef: '',
    note: '',
  };
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
  // The treasurer's "I know this is more than it holds". It belongs to one amount and one pot, so
  // changing either takes the tick away.
  const [confirmOverdraw, setConfirmOverdraw] = useState(false);

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
    if (field === 'amount') setConfirmOverdraw(false);
    setForm((f) => ({ ...f, [field]: value }));
  }

  function startEdit(expense) {
    setConfirmOverdraw(false);
    setEditingId(expense.id);
    setForm({
      source: expense.source === 'group' || expense.fromGroupTotal ? 'group' : 'fund',
      typeId: expense.fundId || '',
      amount: String(expense.amount ?? ''),
      date: expense.date ? isoDateOf(expense.date) : todayISO(),
      description: expense.description || '',
      reference: expense.reference || '',
      approvalRef: expense.approvalRef || '',
      note: expense.note || '',
    });
    amountRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // One control, two kinds of answer: a fund, or the group's total money. Keeping it in
  // the same picker means the treasurer does not have to learn a second step to record
  // the group's biggest purchases.
  function pickSource(event) {
    const value = event.target.value;
    setConfirmOverdraw(false);
    if (value === 'group') {
      setForm((f) => ({ ...f, source: 'group' }));
      return;
    }
    setForm((f) => ({ ...f, source: 'fund', typeId: value }));
  }

  function cancelEdit() {
    setConfirmOverdraw(false);
    setEditingId('');
    setForm({ ...emptyForm(), typeId: selectedFund?.id || '' });
  }

  async function submit(e) {
    e.preventDefault();
    const n = Number(String(form.amount).replace(/,/g, ''));
    const fromGroup = form.source === 'group';
    if (!fromGroup && (!selectedFund || !form.typeId)) {
      toast('Choose the fund this was spent from', 'error');
      return;
    }
    if (!Number.isFinite(n) || n <= 0) {
      toast('Enter an amount greater than zero', 'error');
      return;
    }
    // A group purchase names no fund, so what it was for is what identifies it.
    if (fromGroup && !form.description.trim()) {
      toast('Say what the group bought with it', 'error');
      return;
    }
    if (overdraw && !confirmOverdraw) {
      toast('Tick the box to confirm this is more than it holds', 'error');
      return;
    }
    const body = {
      confirmOverdraw: Boolean(overdraw && confirmOverdraw),
      source: fromGroup ? 'group' : 'fund',
      typeId: fromGroup ? null : form.typeId,
      amount: n,
      date: form.date || todayISO(),
      description: form.description.trim(),
      reference: form.reference.trim(),
      approvalRef: form.approvalRef.trim(),
      note: form.note.trim(),
    };

    setBusy(true);
    try {
      if (editingId) {
        await api.patch(`/api/expenses/${editingId}`, body);
        toast('Expense corrected — the change is in the audit trail');
      } else {
        await api.post('/api/expenses', body);
        if (fromGroup) {
          toast(
            `${money(n)} recorded against the group's total money${
              Number(holding.netBalance) - n < 0 ? ' — that is more than the group holds' : ''
            }`
          );
        } else {
          toast(
            `${money(n)} recorded against ${selectedFund.name}${
              selectedFund.balance - n < 0 ? ' — that fund is now overdrawn' : ''
            }`
          );
        }
      }
      setEditingId('');
      setConfirmOverdraw(false);
      setForm({ ...emptyForm(body.date), source: form.source, typeId: form.typeId });
      await load();
    } catch (err) {
      toast(apiMessage(err), 'error');
      // What the screen thought the pot held was out of date: reload, so the box appears.
      if (err?.response?.data?.code === 'OVERDRAW') await load();
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

  // Whether this expense would take more than its pot holds — the same rule the server applies. A
  // correction's own amount is already off the pot, so it is given back first, and one that does
  // not take more than it did needs no tick.
  const overdraw = (() => {
    const n = Number(String(form.amount).replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) return null;
    const fromGroup = form.source === 'group';
    if (!fromGroup && !selectedFund) return null;
    const pot = fromGroup ? "the group's total money" : selectedFund.name;
    const current = editingId ? expenses.find((x) => x.id === editingId) : null;
    const samePot =
      current &&
      (current.source === 'group' || current.fromGroupTotal ? 'group' : 'fund') === form.source &&
      (fromGroup || String(current.fundId) === String(selectedFund.id));
    const gives = samePot ? Number(current.amount) || 0 : 0;
    const room = Math.round(((fromGroup ? Number(holding.netBalance) : Number(selectedFund.balance)) + gives) * 100) / 100;
    const shortfall = Math.round((n - room) * 100) / 100;
    if (shortfall <= 0 || (samePot && n <= gives)) return null;
    return { pot, room, shortfall };
  })();
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
        <CompactStat
          label="Money in, all time"
          value={money(holding.totalContributed)}
          hint="Members and funds, carry-in included"
        />
        <CompactStat
          label="Group funds hold"
          value={money(groupFund.holds)}
          hint={`${money(groupFund.in)} came in − ${money(groupFund.spent)} spent${
            groupFund.onLoan > 0 ? ` − ${money(groupFund.onLoan)} out on loan` : ''
          }`}
          accent
        />
        <CompactStat
          label="Spent, and deducted"
          value={`− ${money(holding.totalExpenses)}`}
          hint={`${money(holding.spentFromFunds)} out of the funds${
            holding.spentFromGroupTotal > 0
              ? ` + ${money(holding.spentFromGroupTotal)} out of the group's total`
              : ''
          } — loans and advances are not counted`}
          alert
        />
        <CompactStat
          label="The group holds now"
          value={money(holding.netBalance)}
          hint="Everything in (members' money included), less everything spent"
        />
      </section>

      {/* Recording what was spent. Two roles may do this — admin and treasurer — and
          the API refuses anyone else, so this form is safe to render on the page. */}
      <ExpenseForm
        amountRef={amountRef}
        busy={busy}
        cancelEdit={cancelEdit}
        confirmOverdraw={confirmOverdraw}
        data={data}
        editing={editing}
        empty={empty}
        form={form}
        funds={funds}
        groupFund={groupFund}
        holding={holding}
        inCredit={inCredit}
        overdraw={overdraw}
        pickSource={pickSource}
        selectedFund={selectedFund}
        set={set}
        setConfirmOverdraw={setConfirmOverdraw}
        submit={submit}
      />

      <ExpenseSummaries byFund={byFund} byMonth={byMonth} />


      {/* Every entry, newest first: the record itself, with what it was for and the
          voucher it is backed by, and the two ways of correcting one. */}
      <ExpenseList
        editingId={editingId}
        expenses={expenses}
        setDeleting={setDeleting}
        startEdit={startEdit}
        totalSpent={totalSpent}
      />

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

