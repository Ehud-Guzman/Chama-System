import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate } from '../utils/format';
import Loader from '../components/shared/Loader';

// The go-live screen: the week cycle figures and each member's carry-forward
// balance. The suggestions are what the ledger already says each member holds,
// so the usual run is "Use all suggestions" → check the total → Save — no
// retyping 32 figures off a spreadsheet.
export default function FinanceSetup() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(null);
  const [balances, setBalances] = useState({});

  useEffect(() => {
    api
      .get('/api/ledger/setup')
      .then((res) => {
        setData(res.data);
        setSettings({
          ...res.data.settings,
          weekAnchorDate: res.data.settings.weekAnchorDate
            ? String(res.data.settings.weekAnchorDate).slice(0, 10)
            : '',
        });
        setBalances(
          Object.fromEntries(res.data.members.map((m) => [m._id, String(m.openingBalance || 0)]))
        );
      })
      .catch((err) => toast(apiMessage(err, 'Could not load the setup'), 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  function useSuggestions() {
    setBalances(Object.fromEntries(data.members.map((m) => [m._id, String(m.suggested)])));
    toast('Suggestions loaded — check them, then save');
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.patch('/api/ledger/setup', {
        cycleStartWeek: Number(settings.cycleStartWeek),
        weeklyAmount: Number(settings.weeklyAmount),
        chaiAmount: Number(settings.chaiAmount),
        weekAnchorDate: settings.weekAnchorDate || undefined,
        balances: data.members.map((m) => ({
          memberId: m._id,
          openingBalance: Number(balances[m._id] || 0),
        })),
      });
      toast(`Saved — ${res.data.balancesSaved} opening balance(s) updated`);
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loader />;
  if (!data || !settings) return null;

  const enteredTotal = data.members.reduce((s, m) => s + Number(balances[m._id] || 0), 0);

  return (
    <form onSubmit={save} className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin/finance" className="text-xs font-medium text-primary">
            ← Back to the ledger
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Opening balances — the one-time week {settings.cycleStartWeek} setup</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Key in what each member holds today. This is the only manual entry the system needs: every
            week from week {settings.cycleStartWeek} onward is counted on top of these figures, and the
            week number and the amount required then roll forward on their own every Friday. Each
            member’s current ledger total is filled in as a suggestion — type over any of them, then
            save.
          </p>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save all'}
        </button>
      </header>

      <section className="grid gap-3 rounded-xl border border-rule bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          id="cycleStartWeek"
          label="Week number now"
          value={settings.cycleStartWeek}
          onChange={(v) => setSettings({ ...settings, cycleStartWeek: v })}
        />
        <Field
          id="weeklyAmount"
          label="Required each week"
          value={settings.weeklyAmount}
          onChange={(v) => setSettings({ ...settings, weeklyAmount: v })}
          money
        />
        <Field
          id="chaiAmount"
          label="Tea each week"
          value={settings.chaiAmount}
          onChange={(v) => setSettings({ ...settings, chaiAmount: v })}
          money
        />
        <div>
          <label htmlFor="weekAnchorDate" className="mb-1 block text-xs font-medium">
            Friday that week starts
          </label>
          <input
            id="weekAnchorDate"
            type="date"
            value={settings.weekAnchorDate}
            onChange={(e) => setSettings({ ...settings, weekAnchorDate: e.target.value })}
            className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
          />
        </div>
        <p className="text-xs leading-5 text-muted sm:col-span-2 lg:col-span-4">
          Currently week {data.week.currentWeek}, running {shortDate(data.week.startDate)} →{' '}
          {shortDate(data.week.endDate)}. Changing the start week or the Friday renumbers every week
          already on the ledger, so only do it while setting up.
        </p>
      </section>

      <section className="overflow-hidden rounded-xl border border-rule bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <div>
            <h2 className="text-sm font-bold">Opening balances</h2>
            <p className="mt-0.5 text-xs text-muted">
              What each member held on the paper ledger when this started. It is the base every
              later week is added to.
            </p>
          </div>
          <button
            type="button"
            onClick={useSuggestions}
            className="min-h-11 rounded-lg border border-rule px-4 text-sm font-medium"
          >
            Use all suggestions
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-rule bg-canvas">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">
                  Member
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">
                  From the ledger
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">
                  Opening balance
                </th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const differs = Number(balances[m._id] || 0) !== m.suggested;
                return (
                  <tr key={m._id} className="border-b border-rule last:border-b-0">
                    <td className="px-4 py-2">
                      <p className="font-medium">
                        {m.name}
                        {!m.active && <span className="ml-2 text-xs text-muted">(inactive)</span>}
                      </p>
                      <p className="text-xs text-muted">{m.regNumber || ''}</p>
                    </td>
                    <td className="amount px-4 py-2 text-muted">{money(m.suggested)}</td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={balances[m._id] ?? ''}
                        onChange={(e) => setBalances({ ...balances, [m._id]: e.target.value })}
                        aria-label={`Opening balance for ${m.name}`}
                        className={`amount h-11 w-36 rounded-lg border px-3 text-sm ${
                          differs ? 'border-primary bg-primary/5' : 'border-rule bg-canvas'
                        }`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-rule bg-canvas">
              <tr>
                <td className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-muted" colSpan={2}>
                  Total entered
                </td>
                <td className="amount px-4 py-3 font-bold">{money(enteredTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

    </form>
  );
}

// Small shared input so the four cycle figures stay one shape.
function Field({ id, label, value, onChange, money: isMoney }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm ${
          isMoney ? 'amount' : ''
        }`}
      />
    </div>
  );
}
