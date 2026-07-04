import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from './Toast';
import { money, shortDate, todayISO } from '../../utils/format';

// Expense tracking for any fund flagged tracksExpenses (e.g. Chai) — balance
// shown is contributions collected minus expenses logged, since that fund
// exists to be spent down on meeting refreshments rather than just saved.
export default function ExpensesPanel() {
  const toast = useToast();
  const [fundTypes, setFundTypes] = useState([]);
  const [typeId, setTypeId] = useState('');
  const [expenses, setExpenses] = useState([]);
  const [balance, setBalance] = useState(null);
  const [form, setForm] = useState({ amount: '', description: '', date: todayISO() });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get('/api/types', { params: { all: true } })
      .then((res) => {
        const funds = res.data.types.filter((t) => t.tracksExpenses);
        setFundTypes(funds);
        if (funds.length > 0) setTypeId((prev) => prev || funds[0]._id);
      })
      .catch(() => {});
  }, []);

  async function load(id) {
    if (!id) return;
    try {
      const res = await api.get('/api/expenses', { params: { typeId: id } });
      setExpenses(res.data.expenses);
      setBalance(res.data.balance);
    } catch {
      // Non-fatal
    }
  }

  useEffect(() => {
    load(typeId);
  }, [typeId]);

  async function onSubmit(e) {
    e.preventDefault();
    const n = Number(form.amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast('Enter an amount greater than zero', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/expenses', { typeId, amount: n, description: form.description, date: form.date });
      toast('Expense logged');
      setForm({ amount: '', description: '', date: todayISO() });
      load(typeId);
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (fundTypes.length === 0) return null;

  return (
    <section className="rounded-xl border border-rule bg-surface p-5">
      <h2 className="text-base font-semibold">Fund expenses</h2>
      <p className="mt-1 text-xs text-muted">
        Spending against a fund that tracks expenses — balance is contributions minus expenses.
      </p>

      {fundTypes.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {fundTypes.map((t) => (
            <button
              key={t._id}
              type="button"
              onClick={() => setTypeId(t._id)}
              aria-pressed={typeId === t._id}
              className={`min-h-9 rounded-lg border px-3 text-xs font-semibold ${
                typeId === t._id ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {balance && (
        <div className="mt-3 rounded-lg bg-primary/5 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Balance</p>
          <p className="amount mt-0.5 text-xl font-bold text-primary">{money(balance.balance)}</p>
          <p className="amount mt-1 text-xs text-muted">
            {money(balance.totalContributed)} collected − {money(balance.totalExpenses)} spent
          </p>
        </div>
      )}

      {expenses.length > 0 && (
        <ul className="mt-3 divide-y divide-rule">
          {expenses.map((e) => (
            <li key={e._id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm">{e.description || 'Expense'}</p>
                <p className="text-xs text-muted">{shortDate(e.date)}</p>
              </div>
              <span className="amount shrink-0 text-sm font-medium text-alert">{money(e.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-rule pt-4">
        <p className="text-sm font-medium">Log an expense</p>
        <input
          type="text"
          inputMode="numeric"
          required
          placeholder="Amount (Ksh)"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Expense amount"
        />
        <input
          type="text"
          placeholder="What was it for? e.g. Meeting snacks"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Expense description"
        />
        <input
          type="date"
          max={todayISO()}
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          className="h-12 w-full rounded-xl border border-rule px-3 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-primary text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Logging…' : 'Log expense'}
        </button>
      </form>
    </section>
  );
}
