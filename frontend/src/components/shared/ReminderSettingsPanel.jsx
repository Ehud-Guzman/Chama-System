import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from './Toast';

// How often the group may email a member about what he owes.
//
// This is the one number that decides whether a reminder is read. A member who is behind stays
// behind until he pays, so without a limit the weekly sweep and the reminders screen together
// would tell him the same thing every few days — and the message people learn to ignore is the
// one that matters when the meeting is on Thursday. One a week is the default; 0 switches the
// limit off for a group that would rather nag.
//
// It sits in Settings rather than in the environment because it is the committee's policy, not a
// deploy's: whoever the office asks to stop emailing them should be able to change it without a
// developer. The counting itself is done from the audit trail (utils/reminderLog), so nothing
// resets on a Friday and the reminders screen can show its work.
const MAX_PER_WEEK_CEILING = 20;

// The same ceiling the API enforces on the money line (utils/reminderLimit). Above every member's
// balance the rule stops excluding anybody, so a figure that big is a typo rather than a policy.
const MONEY_LIMIT_CEILING = 10000000;

export default function ReminderSettingsPanel() {
  const toast = useToast();
  const [value, setValue] = useState('1');
  const [saved, setSaved] = useState(1);
  // The money line, and the week the figure was measured in. Blank in the second box means "the
  // week the books opened", which is what a group that has only ever typed one number wants.
  const [moneyLimit, setMoneyLimit] = useState('114600');
  const [limitWeek, setLimitWeek] = useState('');
  const [savedLine, setSavedLine] = useState({ limit: 114600, week: null });
  // The group's own weekly contribution, used only to show what the line becomes next week.
  const [weeklyAmount, setWeeklyAmount] = useState(1400);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .get('/api/settings')
      .then((res) => {
        // A settings document written before these fields existed has no values; the model's own
        // defaults are 1, 114600 and blank, and the screen says the same thing rather than showing
        // empty boxes.
        const current = res.data.settings.reminderMaxPerWeek ?? 1;
        setValue(String(current));
        setSaved(Number(current) || 0);

        const limit = res.data.settings.reminderMoneyLimit ?? 114600;
        const week = res.data.settings.reminderMoneyLimitWeek ?? null;
        setMoneyLimit(String(limit));
        setLimitWeek(week == null ? '' : String(week));
        setSavedLine({ limit: Number(limit) || 0, week });
        setWeeklyAmount(Number(res.data.settings.weeklyAmount) || 1400);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_PER_WEEK_CEILING;

  // Money typed by hand: "114,600" is how a treasurer writes it, and the API wants a number.
  const parsedLimit = Number(String(moneyLimit).replace(/[\s,]/g, ''));
  const limitValid =
    String(moneyLimit).trim() !== '' &&
    Number.isFinite(parsedLimit) &&
    parsedLimit >= 0 &&
    parsedLimit <= MONEY_LIMIT_CEILING;
  const trimmedWeek = String(limitWeek).trim();
  const weekValid =
    trimmedWeek === '' || (Number.isInteger(Number(trimmedWeek)) && Number(trimmedWeek) >= 1);
  const lineChanged =
    limitValid &&
    (parsedLimit !== savedLine.limit ||
      (trimmedWeek === '' ? savedLine.week : Number(trimmedWeek)) !== savedLine.week);

  async function onSubmit(e) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const res = await api.patch('/api/settings', { reminderMaxPerWeek: parsed });
      const stored = Number(res.data.settings.reminderMaxPerWeek);
      setSaved(stored);
      setValue(String(stored));
      toast('Reminder limit saved');
    } catch (err) {
      toast(apiMessage(err, 'Could not save the reminder limit'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Saved on its own, and only when it is actually usable: a form that posted a half-typed
  // 114,00 would quietly lower the group's line for every member.
  async function onSubmitLine(e) {
    e.preventDefault();
    if (!limitValid || !weekValid) return;
    setBusy(true);
    try {
      const res = await api.patch('/api/settings', {
        reminderMoneyLimit: parsedLimit,
        reminderMoneyLimitWeek: trimmedWeek === '' ? null : Number(trimmedWeek),
      });
      const storedLimit = Number(res.data.settings.reminderMoneyLimit) || 0;
      const storedWeek = res.data.settings.reminderMoneyLimitWeek ?? null;
      setMoneyLimit(String(storedLimit));
      setLimitWeek(storedWeek == null ? '' : String(storedWeek));
      setSavedLine({ limit: storedLimit, week: storedWeek });
      toast('Money line saved');
    } catch (err) {
      toast(apiMessage(err, 'Could not save the money line'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-rule bg-surface p-4">
      <h2 className="text-sm font-semibold">Reminders</h2>
      <p className="mt-1 text-xs text-muted">
        How many reminder emails one member may be sent in a week. The week is the group&rsquo;s own
        week — Friday to Thursday — and the count is read back from the audit trail, so the
        reminders screen shows how much of it has been used.
      </p>

      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <div>
          <label htmlFor="reminderMaxPerWeek" className="text-sm font-medium">
            Reminders per member per week
          </label>
          <input
            id="reminderMaxPerWeek"
            type="number"
            min="0"
            max={MAX_PER_WEEK_CEILING}
            step="1"
            inputMode="numeric"
            disabled={!loaded}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-2 h-12 w-32 rounded-xl border border-rule px-4 text-sm"
          />
          <p className="mt-1 text-xs text-muted">
            {parsed === 0
              ? 'No limit — a member can be emailed as often as somebody sends. The fine emails are never counted either way.'
              : valid
                ? `At most ${parsed} reminder${parsed === 1 ? '' : 's'} a week. Once a member has had ${
                    parsed === 1 ? 'his' : 'them'
                  }, the next send skips him with the reason — unless somebody ticks \u201csend anyway\u201d on the Reminders screen, which is recorded.`
                : `Enter a whole number from 0 to ${MAX_PER_WEEK_CEILING}. 0 means no limit.`}
          </p>
        </div>

        <button
          type="submit"
          disabled={busy || !valid || parsed === saved}
          className="min-h-12 shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>

      {/* The money line: who the group stops chasing. Its own form, because it is a different
          decision from the weekly cap and a half-typed figure must not be able to reach the API. */}
      <form onSubmit={onSubmitLine} className="mt-4 space-y-3 border-t border-rule pt-4">
        <div>
          <h3 className="text-sm font-medium">Leave members alone above this much</h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            A member holding at least this much is not told he is behind. He has paid more into the
            cycle than it has asked of him, so a closed week he missed is not a reason to email him —
            his unpaid fines still are. The line rises by the weekly contribution every week, because
            what the figure is being measured against is what the group expected of him by then.
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="reminderMoneyLimit" className="text-xs font-medium text-muted">
                Amount held (0 tells everybody who is behind)
              </label>
              <input
                id="reminderMoneyLimit"
                type="text"
                inputMode="numeric"
                disabled={!loaded}
                value={moneyLimit}
                onChange={(e) => setMoneyLimit(e.target.value)}
                className="amount mt-1 h-12 w-40 rounded-xl border border-rule px-4 text-sm"
              />
            </div>
            <div>
              <label htmlFor="reminderMoneyLimitWeek" className="text-xs font-medium text-muted">
                Measured in week (blank = the week the books opened)
              </label>
              <input
                id="reminderMoneyLimitWeek"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                placeholder="its opening week"
                disabled={!loaded}
                value={limitWeek}
                onChange={(e) => setLimitWeek(e.target.value)}
                className="amount mt-1 h-12 w-40 rounded-xl border border-rule px-4 text-sm"
              />
            </div>
          </div>

          <p className="mt-1 text-xs text-muted">
            {!limitValid
              ? `Enter an amount from 0 to ${MONEY_LIMIT_CEILING.toLocaleString('en-KE')}.`
              : !weekValid
                ? 'The week has to be a whole week number, like 92.'
                : parsedLimit === 0
                  ? 'Off: every member who is behind is told, whatever he is holding.'
                  : `${moneyLabel(parsedLimit)} in the week you name, and ${moneyLabel(
                      parsedLimit + weeklyAmount
                    )} the week after — the group's own ${moneyLabel(
                      weeklyAmount
                    )} a week is added each week the cycle runs.`}
          </p>
        </div>

        <button
          type="submit"
          disabled={busy || !limitValid || !weekValid || !lineChanged}
          className="min-h-12 shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </section>
  );
}

// The figure as the office reads it back, so a typed 114600 is confirmed in words rather than
// trusted: a misplaced zero here is a policy that leaves half the group unchased.
function moneyLabel(n) {
  return 'Ksh ' + Number(n || 0).toLocaleString('en-KE');
}
