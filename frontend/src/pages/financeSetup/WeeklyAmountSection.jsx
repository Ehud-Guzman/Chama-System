import { useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../../components/shared/Toast';
import { money, shortDate } from '../../utils/format';

// Raising the weekly contribution, from a week the group chooses.
//
// The weekly amount is not one number for all time: a rise starts at a week and applies from it onward, so the
// weeks before it keep what they asked, what members have already paid stays paid, and the group's line rises by
// the new amount each week from the start. Nothing is saved until the change has been previewed, and a change can
// be taken back until its week closes. The tea does not change here.
//
// It sits inside the setup page's form, so Enter is caught on its own boxes: it previews, and never submits the
// page's "Save all".
export default function WeeklyAmountSection({ data, onChanged }) {
  const toast = useToast();
  const { settings, week } = data;
  const current = week.currentWeek;
  const changes = settings.weeklyAmountChanges || [];
  const nowAsked = settings.weeklyAmountNow ?? settings.weeklyAmount;

  const [amount, setAmount] = useState('');
  const [fromWeek, setFromWeek] = useState(String(current + 1));
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [takingBack, setTakingBack] = useState(null);

  const edit = (setter) => (value) => {
    setter(value);
    // What was previewed is no longer what is typed.
    setPreview(null);
    setError('');
  };

  async function send(dryRun) {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/api/ledger/weekly-amount', { fromWeek, amount, reason, dryRun });
      if (dryRun) {
        setPreview(res.data.preview);
      } else {
        toast(`From week ${res.data.preview.fromWeek} the weekly amount is ${money(res.data.preview.amountAfter)}`);
        setAmount('');
        setReason('');
        setPreview(null);
        setFromWeek(String(current + 1));
        await onChanged();
      }
    } catch (err) {
      setPreview(null);
      setError(apiMessage(err, 'Could not save the change'));
    } finally {
      setBusy(false);
    }
  }

  async function takeBack(entry) {
    setBusy(true);
    try {
      await api.delete(`/api/ledger/weekly-amount/${entry.fromWeek}`);
      toast(`The change from week ${entry.fromWeek} was taken back`);
      setTakingBack(null);
      await onChanged();
    } catch (err) {
      toast(apiMessage(err, 'Could not take the change back'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Enter previews; it must never reach the page's own submit.
  const onEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!busy) send(true);
    }
  };

  return (
    <section className="rounded-xl border border-rule bg-surface p-4">
      <h2 className="text-sm font-bold">Change the weekly amount from a week</h2>
      <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted">
        The weekly contribution is {money(nowAsked)} a week now
        {settings.weeklyAmount !== nowAsked ? ` (the cycle opened with ${money(settings.weeklyAmount)})` : ''}. To raise it,
        pick the amount and the week it starts from. Weeks before that week keep what they asked, what members have
        already paid is not touched, and the group&rsquo;s line rises by the new amount each week from then on. The tea
        stays at {money(settings.chaiAmount)}.
      </p>

      {changes.length > 0 && (
        <ul className="mt-3 divide-y divide-rule overflow-hidden rounded-lg border border-rule text-sm">
          {changes.map((c) => {
            const started = c.fromWeek <= current;
            const closed = c.fromWeek < current;
            return (
              <li key={c.fromWeek} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <span>
                  <span className="font-semibold">From week {c.fromWeek}</span>{' '}
                  <span className="text-muted">({shortDate(c.startDate)})</span>: <span className="amount font-semibold">{money(c.amount)}</span> a week
                  {c.reason ? <span className="block text-xs text-muted">{c.reason}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted">{closed ? 'in force, weeks have been asked it' : started ? 'this week' : 'not started yet'}</span>
                  {!closed &&
                    (takingBack === c.fromWeek ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => takeBack(c)}
                        className="min-h-9 rounded-lg border border-alert/40 bg-alert/5 px-3 text-xs font-semibold text-alert"
                      >
                        Really take it back
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setTakingBack(c.fromWeek)}
                        className="min-h-9 rounded-lg border border-rule px-3 text-xs font-medium"
                      >
                        Take back
                      </button>
                    ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="newWeeklyAmount" className="mb-1 block text-xs font-medium">New weekly amount</label>
          <input
            id="newWeeklyAmount"
            inputMode="numeric"
            value={amount}
            onChange={(e) => edit(setAmount)(e.target.value)}
            onKeyDown={onEnter}
            placeholder="e.g. 2000"
            className="amount h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="newWeeklyFrom" className="mb-1 block text-xs font-medium">Starts from week</label>
          <input
            id="newWeeklyFrom"
            inputMode="numeric"
            value={fromWeek}
            onChange={(e) => edit(setFromWeek)(e.target.value)}
            onKeyDown={onEnter}
            className="amount h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
          />
          <p className="mt-1 text-[11px] text-muted">This week is {current}. A week that has closed cannot be changed.</p>
        </div>
        <div>
          <label htmlFor="newWeeklyReason" className="mb-1 block text-xs font-medium">Why (optional, kept in the audit trail)</label>
          <input
            id="newWeeklyReason"
            value={reason}
            onChange={(e) => edit(setReason)(e.target.value)}
            onKeyDown={onEnter}
            maxLength={300}
            placeholder="e.g. agreed at the meeting"
            className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-alert/30 bg-alert/5 px-3 py-2 text-sm text-alert" role="alert">
          {error}
        </p>
      )}

      {preview ? (
        <div className="mt-3 space-y-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm leading-6">
          <p>
            <span className="font-semibold">
              From week {preview.fromWeek} ({shortDate(preview.startDate)}) each member is asked {money(preview.amountAfter)} a week
              instead of {money(preview.amountBefore)}.
            </span>{' '}
            The group&rsquo;s line in that week goes from {money(preview.line.atStartBefore)} to{' '}
            <span className="amount font-semibold">{money(preview.line.atStartAfter)}</span>, and then rises {money(preview.amountAfter)} a
            week. Every week before {preview.fromWeek} is left exactly as it is.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => send(false)}
              className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Confirm the change'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPreview(null)}
              className="min-h-11 rounded-xl border border-rule bg-surface px-4 text-sm font-medium"
            >
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <button
            type="button"
            disabled={busy || !String(amount).trim()}
            onClick={() => send(true)}
            className="min-h-11 rounded-xl border border-rule bg-surface px-5 text-sm font-semibold disabled:opacity-60"
          >
            {busy ? 'Checking…' : 'Preview the change'}
          </button>
        </div>
      )}
    </section>
  );
}
