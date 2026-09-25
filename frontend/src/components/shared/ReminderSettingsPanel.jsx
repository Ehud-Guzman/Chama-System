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

export default function ReminderSettingsPanel() {
  const toast = useToast();
  const [value, setValue] = useState('1');
  const [saved, setSaved] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .get('/api/settings')
      .then((res) => {
        // A settings document written before this field existed has no value; the model's own
        // default is one, and the screen says the same thing rather than showing a blank box.
        const current = res.data.settings.reminderMaxPerWeek ?? 1;
        setValue(String(current));
        setSaved(Number(current) || 0);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_PER_WEEK_CEILING;

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
    </section>
  );
}
