import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import { money, shortDate } from '../utils/format';
import { invalidateLedger } from '../services/ledgerCache';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import WeeklyAmountSection from './financeSetup/WeeklyAmountSection';
import BackLink from '../components/shared/BackLink';
import Loader from '../components/shared/Loader';
import OpeningBalancesSection from './financeSetup/OpeningBalancesSection';
import FundsSection from './financeSetup/FundsSection';
import WeekCollectionSection from './financeSetup/WeekCollectionSection';
import { Field } from './financeSetup/shared';

// Money typed by hand: "1,400", " 1400 " and "Ksh 1400" all mean the same number —
// Number() alone reads two of those three as NaN, which is how a sheet full of good
// figures ends up saving nothing. A blank box means "leave this one as it is".
function readAmount(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/^ksh/i, '')
    .replace(/[\s,\u00a0]/g, '');
  if (text === '') return { skip: true };
  const amount = Number(text);
  return Number.isFinite(amount) ? { amount } : { invalid: true };
}

function numberOrUndefined(value) {
  const read = readAmount(value);
  return read.skip ? undefined : read.amount;
}

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
  // Each fund's own one-time carry-in, the same idea as a member's balance: the
  // tea float, registration already collected, and so on.
  const [funds, setFunds] = useState({});
  const [newFund, setNewFund] = useState({
    name: '',
    isGroupFund: true,
    tracksExpenses: true,
  });
  const [addingFund, setAddingFund] = useState(false);
  // The one-time week collection — a whole week paid in cash for every member,
  // which is what week 91 is: the week the paper ledger closed just before the
  // books opened. It previews before it posts, and it can be taken back out.
  const [collect, setCollect] = useState({
    weekNumber: '91',
    weeklyAmount: '1500',
    chaiAmount: '100',
    method: 'cash',
  });
  const [preview, setPreview] = useState(null);
  const [collecting, setCollecting] = useState(false);
  const [confirming, setConfirming] = useState(null); // 'post' | 'undo' | null
  // A save that would cut the members' total hard comes back as a 409 carrying
  // both totals — this holds that answer while the treasurer decides.
  const [massSave, setMassSave] = useState(null);
  // The figures on this page are the base every balance in the system is counted
  // from: the members' carried-in totals, the funds' floats, and the week cycle
  // itself. They sit one scroll wheel or one wrong row away from being changed, so
  // they are read-only until somebody says out loud that they mean to edit them.
  const [unlocked, setUnlocked] = useState(false);
  const [unlockPrompt, setUnlockPrompt] = useState(false);
  const locked = !unlocked;

  const apply = useCallback((payload) => {
    setData(payload);
    setSettings({
      ...payload.settings,
      weekAnchorDate: payload.settings.weekAnchorDate
        ? String(payload.settings.weekAnchorDate).slice(0, 10)
        : '',
    });
    setBalances(
      Object.fromEntries(payload.members.map((m) => [m._id, String(m.openingBalance || 0)]))
    );
    setFunds(
      Object.fromEntries((payload.funds || []).map((f) => [f.typeId, String(f.openingBalance || 0)]))
    );
  }, []);

  const reload = useCallback(async () => {
    const res = await api.get('/api/ledger/setup');
    apply(res.data);
    return res.data;
  }, [apply]);

  useEffect(() => {
    reload()
      .catch((err) => toast(apiMessage(err, 'Could not load the setup'), 'error'))
      .finally(() => setLoading(false));
  }, [reload, toast]);

  // A fund the group collects that is not in the system yet — registration,
  // resignation, welfare. Created here so its one-time total can be entered on
  // the same screen rather than sending the treasurer somewhere else.
  async function addFund() {
    const name = newFund.name.trim();
    if (!name) {
      toast('Give the fund a name', 'error');
      return;
    }
    setAddingFund(true);
    try {
      await api.post('/api/types', {
        name,
        isGroupFund: newFund.isGroupFund,
        tracksExpenses: newFund.tracksExpenses,
      });
      toast(`${name} added — now give it its current total`);
      setNewFund({ name: '', isGroupFund: true, tracksExpenses: true });
      await reload();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setAddingFund(false);
    }
  }

  function useSuggestions() {
    setBalances(Object.fromEntries(data.members.map((m) => [m._id, String(m.suggested)])));
    toast('Suggestions loaded — check them, then save');
  }

  // Locking again drops anything typed but not saved: the boxes go back to what the
  // server holds, so a half-finished correction cannot sit there and be written up
  // by whoever unlocks next.
  async function lockAgain() {
    setUnlocked(false);
    try {
      await reload();
    } catch (err) {
      toast(apiMessage(err, 'Could not refresh the figures'), 'error');
    }
  }

  async function save(e, { confirm: massConfirm } = {}) {
    e?.preventDefault?.();

    // Every box is checked before anything is sent, and the offending one is named:
    // a figure like "1,4oo" used to be dropped without a word, which looked exactly
    // like the save failing.
    const rows = [
      ...data.members.map((m) => ({ label: m.name, value: balances[m._id] })),
      ...(data.funds || []).map((f) => ({ label: `${f.name} fund`, value: funds[f.typeId] })),
    ];
    const bad = rows.find((row) => readAmount(row.value).invalid);
    if (bad) {
      toast(`“${bad.label}”: “${bad.value}” is not a number — use digits, e.g. 1400 or 1,400`, 'error');
      return;
    }

    setBusy(true);
    try {
      const res = await api.patch('/api/ledger/setup', {
        // The figures go up as typed — the API reads "1,400" and treats a blank box
        // as "leave it", so nothing here has to guess.
        cycleStartWeek: numberOrUndefined(settings.cycleStartWeek),
        weeklyAmount: numberOrUndefined(settings.weeklyAmount),
        chaiAmount: numberOrUndefined(settings.chaiAmount),
        weekAnchorDate: settings.weekAnchorDate || undefined,
        balances: data.members.map((m) => ({
          memberId: m._id,
          openingBalance: balances[m._id],
        })),
        funds: (data.funds || []).map((f) => ({
          typeId: f.typeId,
          openingBalance: funds[f.typeId],
        })),
        // Only sent once the treasurer has seen what a big drop would do — see
        // the 409 branch below. The API refuses a sheet that cuts the members'
        // total by a quarter or more without it.
        confirm: massConfirm === true ? true : undefined,
      });
      const memberSaved = res.data.balancesSaved ?? 0;
      const fundSaved = res.data.fundsSaved ?? 0;
      const total = res.data.summary?.after;
      toast(
        memberSaved + fundSaved === 0
          ? 'Saved — nothing had changed'
          : `Saved — ${memberSaved} member balance(s) and ${fundSaved} fund total(s) changed${
              total === undefined ? '' : `, members now total ${money(total)}`
            }`
      );
      await reload();
      // The save locks the page again. A correction is a deliberate act, and an
      // unlocked sheet left open behind a counter is one stray keystroke away from
      // a wrong member's money.
      setUnlocked(false);
    } catch (err) {
      const status = err.response?.status;
      // A save that would wipe the members' total is held back once, with both
      // totals in hand, rather than written and regretted: the boxes stay filled
      // in so the wrong one can be fixed, or the drop confirmed deliberately.
      if (status === 409 && err.response?.data?.confirmation) {
        setMassSave(err.response.data.confirmation);
        return;
      }
      toast(
        apiMessage(
          err,
          status
            ? `Could not save (HTTP ${status}).`
            : 'Could not save — check your connection and try again.'
        ),
        'error'
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loader />;
  if (!data || !settings) return null;

  const enteredTotal = data.members.reduce((s, m) => s + Number(balances[m._id] || 0), 0);
  // What the boxes held when the page loaded — one save replaces all of them, so
  // showing this beside the entered total is what makes a mis-typed sheet obvious
  // before it is written rather than after.
  const storedMembersTotal = data.members.reduce((s, m) => s + Number(m.openingBalance || 0), 0);
  const fundsTotal = (data.funds || []).reduce((s, f) => s + Number(funds[f.typeId] || 0), 0);

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
          <BackLink to="/admin/finance">Back to the ledger</BackLink>
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
          disabled={busy || locked}
          title={locked ? 'Unlock to edit first' : undefined}
          className="min-h-12 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save all'}
        </button>
      </header>

      {/* Editing is locked until somebody says otherwise. These boxes are the base
          every balance in the system is counted from: a scroll wheel over a focused
          number, or a thumb on the wrong row, would move a member's money without
          anybody deciding to — and the page is one "Save all" away from writing it.
          Unlocking is deliberate, saving re-locks it, and locking again drops
          anything that was not saved. */}
      <section
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
          locked ? 'border-rule bg-surface' : 'border-alert/40 bg-alert/5'
        }`}
      >
        <div className="min-w-0">
          <p
            className={`flex items-center gap-2 text-sm font-semibold ${
              locked ? 'text-ink' : 'text-alert'
            }`}
          >
            <LockIcon open={!locked} />
            {locked ? 'Locked' : 'Editing is unlocked'}
          </p>
          <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted">
            {locked
              ? 'The member balances, the fund floats and the week figures cannot be typed in by accident. Unlock to correct one.'
              : 'Change the figures below, then Save all. The page locks itself again when the save goes through, and every change stays in the audit trail.'}
          </p>
        </div>
        <button
          type="button"
          onClick={locked ? () => setUnlockPrompt(true) : lockAgain}
          className="min-h-11 shrink-0 rounded-lg border border-rule bg-surface px-4 text-sm font-medium transition hover:border-primary/40 hover:bg-primary/5"
        >
          {locked ? 'Unlock to edit' : 'Lock again'}
        </button>
      </section>

      <section className="grid gap-3 rounded-xl border border-rule bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          id="cycleStartWeek"
          label="Week number now (the group's shared count)"
          value={settings.cycleStartWeek}
          onChange={(v) => setSettings({ ...settings, cycleStartWeek: v })}
          disabled={locked}
        />
        <Field
          id="weeklyAmount"
          label={
            data.settings.weeksClosed > 0
              ? 'Required each week when the cycle opened (raise it below)'
              : 'Required each week (the weekly contribution)'
          }
          value={settings.weeklyAmount}
          onChange={(v) => setSettings({ ...settings, weeklyAmount: v })}
          money
          // Once a week has been asked this amount it is history: a rise goes in below, from a week that has not closed.
          disabled={locked || data.settings.weeksClosed > 0}
        />
        <Field
          id="chaiAmount"
          label="Tea each week (deducted automatically)"
          value={settings.chaiAmount}
          onChange={(v) => setSettings({ ...settings, chaiAmount: v })}
          money
          disabled={locked}
        />
        <div>
          <label htmlFor="weekAnchorDate" className="mb-1 block text-xs font-medium">
            Friday that week starts (the week runs Friday → Thursday)
          </label>
          <input
            id="weekAnchorDate"
            type="date"
            value={settings.weekAnchorDate}
            onChange={(e) => setSettings({ ...settings, weekAnchorDate: e.target.value })}
            disabled={locked}
            className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <p className="text-xs leading-5 text-muted sm:col-span-2 lg:col-span-4">
          Currently week {data.week.currentWeek}, running {shortDate(data.week.startDate)} →{' '}
          {shortDate(data.week.endDate)}. Changing the start week or the Friday renumbers every week
          already on the ledger, so only do it while setting up.
        </p>
      </section>

      <WeeklyAmountSection data={data} onChanged={reload} />

      <OpeningBalancesSection
        balances={balances}
        data={data}
        enteredTotal={enteredTotal}
        locked={locked}
        setBalances={setBalances}
        storedMembersTotal={storedMembersTotal}
        useSuggestions={useSuggestions}
      />

      {/* The group's funds, each with the total it already held. */}
      <FundsSection
        addFund={addFund}
        addingFund={addingFund}
        data={data}
        funds={funds}
        fundsTotal={fundsTotal}
        locked={locked}
        newFund={newFund}
        setFunds={setFunds}
        setNewFund={setNewFund}
      />

      {/* One week, collected for everybody — the one-time bulk entry. */}
      <WeekCollectionSection
        collect={collect}
        collecting={collecting}
        preview={preview}
        runCollect={runCollect}
        setCollect={setCollect}
        setConfirming={setConfirming}
        setPreview={setPreview}
      />

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

      {/* Unlocking is the deliberate act the rest of this page hangs on, so it gets
          the same dialog treatment as the other things that move money. Nothing is
          written by unlocking — it only makes the boxes typeable — but a treasurer
          should know what they are about to be able to change. */}
      <ConfirmDialog
        open={unlockPrompt}
        title="Unlock these figures for editing?"
        body="Opening balances and fund floats are the base every balance is counted from: change one and that member's money changes on every screen. The week figures move everybody's. Nothing is written until you press Save all, a save that cuts the members' total by a quarter or more stops and asks again, and every change stays in the audit trail."
        confirmLabel="Unlock"
        onConfirm={() => {
          setUnlockPrompt(false);
          setUnlocked(true);
        }}
        onCancel={() => setUnlockPrompt(false)}
      />

      {/* The one button that can take 32 verified balances out at once, so a save
          that would cut the total by a quarter or more stops here first. The API
          refused the request (409) and nothing has been written. */}
      <ConfirmDialog
        open={Boolean(massSave)}
        title="This save cuts the members' total"
        body={
          massSave
            ? `${massSave.changed} member balance(s) would change and the total would go from ${money(
                massSave.before
              )} to ${money(
                massSave.after
              )}. Nothing is lost if you go ahead — the figures it replaces stay in the audit trail and can be put back — but check the boxes first.`
            : ''
        }
        confirmLabel="Save it anyway"
        danger
        busy={busy}
        onConfirm={() => {
          setMassSave(null);
          save(null, { confirm: true });
        }}
        onCancel={() => setMassSave(null)}
      />

    </form>
  );
}

// Padlock, closed or open: the one thing on this page a treasurer has to be able to
// read at a glance before touching anything.
function LockIcon({ open = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      {open ? <path d="M8 11V7a4 4 0 0 1 7.5-2" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}
