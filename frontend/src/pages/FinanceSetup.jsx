import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate, METHOD_LABELS } from '../utils/format';
import { invalidateLedger } from '../services/ledgerCache';
import ConfirmDialog from '../components/shared/ConfirmDialog';
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
  // The one-time week collection — a whole week paid in cash for every member,
  // which is what week 91 is: the week the paper ledger closed just before the
  // books opened. It previews before it posts, and it can be taken back out.
  const [collect, setCollect] = useState({
    weekNumber: '91',
    weeklyAmount: '1400',
    chaiAmount: '100',
    method: 'cash',
  });
  const [preview, setPreview] = useState(null);
  const [collecting, setCollecting] = useState(false);
  const [confirming, setConfirming] = useState(null); // 'post' | 'undo' | null

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

  function describe(d, posted) {
    const each = d.perMember.weekly - d.perMember.chai;
    return [
      `Week ${d.weekNumber}, closing Thursday ${shortDate(d.date)}.`,
      `${d.posted} member${d.posted === 1 ? '' : 's'}`,
      d.skipped ? `(${d.skipped} already had it)` : '',
      `— ${money(d.totals.weekly)} in contributions + ${money(d.totals.chai)} in tea = ${money(
        d.totals.cash
      )} of cash.`,
      `Each member: +${money(d.perMember.weekly)} contributed, −${money(
        d.perMember.chai
      )} tea, so his money goes up by ${money(each)} and the Tea Fund gains ${money(
        d.perMember.chai
      )} per member.`,
      posted ? 'Posted.' : 'Nothing saved yet — preview only.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  async function runCollect(dryRun) {
    const week = Number(collect.weekNumber);
    if (!Number.isInteger(week) || week < 1) {
      toast('Enter the week number', 'error');
      return;
    }
    setConfirming(null);
    setCollecting(true);
    try {
      const res = await api.post('/api/ledger/collect-week', {
        weekNumber: week,
        weeklyAmount: Number(collect.weeklyAmount || 0),
        chaiAmount: Number(collect.chaiAmount || 0),
        method: collect.method,
        dryRun,
      });
      setPreview({ ...res.data, message: describe(res.data, !dryRun) });
      if (!dryRun) {
        toast(
          `Week ${res.data.weekNumber} posted for ${res.data.posted} member${
            res.data.posted === 1 ? '' : 's'
          }`
        );
        // The ledger just moved: everything cached from it is now a lie.
        invalidateLedger();
      }
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setCollecting(false);
    }
  }

  async function undoCollect() {
    const week = Number(collect.weekNumber);
    setConfirming(null);
    setCollecting(true);
    try {
      const res = await api.delete('/api/ledger/collect-week', { params: { weekNumber: week } });
      toast(
        `Removed ${res.data.removed} entr${res.data.removed === 1 ? 'y' : 'ies'} for week ${week}`
      );
      setPreview(null);
      invalidateLedger();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setCollecting(false);
    }
  }

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

      {/* One week, collected for everybody — the one-time bulk entry. */}
      <section className="rounded-xl border border-rule bg-surface p-4">
        <h2 className="text-sm font-bold">A whole week collected for everybody (one-time)</h2>
        <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted">
          For a week paid in cash before the books opened — week 91 is the one: every member paid
          that week&rsquo;s contribution and that week&rsquo;s tea. It posts both rows for every
          active member at once, dated on the Thursday the week closed, so the money shows against
          week 91 rather than against the opening week. Preview first: nothing is written until you
          post it, and it can be taken back out.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            id="collectWeek"
            label="Week number"
            value={collect.weekNumber}
            onChange={(v) => {
              setPreview(null);
              setCollect({ ...collect, weekNumber: v });
            }}
          />
          <Field
            id="collectWeekly"
            label="Contribution each"
            value={collect.weeklyAmount}
            onChange={(v) => {
              setPreview(null);
              setCollect({ ...collect, weeklyAmount: v });
            }}
            money
          />
          <Field
            id="collectChai"
            label="Tea each"
            value={collect.chaiAmount}
            onChange={(v) => {
              setPreview(null);
              setCollect({ ...collect, chaiAmount: v });
            }}
            money
          />
          <div>
            <label htmlFor="collectMethod" className="mb-1 block text-xs font-medium">
              How it came in
            </label>
            <select
              id="collectMethod"
              value={collect.method}
              onChange={(e) => {
                setPreview(null);
                setCollect({ ...collect, method: e.target.value });
              }}
              className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
            >
              {Object.entries(METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => runCollect(true)}
            disabled={collecting}
            className="min-h-11 rounded-lg border border-rule px-4 text-sm font-medium disabled:opacity-60"
          >
            {collecting ? 'Checking…' : 'Preview'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming('post')}
            disabled={collecting || !preview || preview.posted === 0}
            className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
          >
            Post it for everyone
          </button>
          <button
            type="button"
            onClick={() => setConfirming('undo')}
            disabled={collecting}
            className="min-h-11 rounded-lg px-4 text-sm font-medium text-alert disabled:opacity-60"
          >
            Undo this week&rsquo;s batch
          </button>
        </div>

        {preview && (
          <p className="mt-3 rounded-xl border border-rule bg-canvas px-4 py-3 text-xs leading-5">
            {preview.message}
            {preview.posted > 6 && preview.membersAffected?.length > 0 && (
              <span className="mt-1 block text-muted">
                {preview.membersAffected.length} members, from {preview.membersAffected[0]}
              </span>
            )}
          </p>
        )}
      </section>

      <ConfirmDialog
        open={confirming === 'post'}
        title="Post this week for every member?"
        body={`${preview?.posted || 0} members will each get ${money(
          Number(collect.weeklyAmount) || 0
        )} of contribution and ${money(Number(collect.chaiAmount) || 0)} of tea for week ${
          collect.weekNumber
        }. It can be taken back out afterwards.`}
        confirmLabel="Post it"
        busy={collecting}
        onConfirm={() => runCollect(false)}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        open={confirming === 'undo'}
        title={`Undo week ${collect.weekNumber}?`}
        body="Every entry this batch posted is marked deleted, so the money comes off the members and the Tea Fund again. The records stay in the audit trail."
        confirmLabel="Undo it"
        danger
        busy={collecting}
        onConfirm={undoCollect}
        onCancel={() => setConfirming(null)}
      />

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
