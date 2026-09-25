import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useToast } from '../components/shared/Toast';
import ErrorState from '../components/shared/ErrorState';
import Loader from '../components/shared/Loader';
import BackLink from '../components/shared/BackLink';
import MemberAvatar from '../components/members/MemberAvatar';
import { money, shortDate, shortDateTime } from '../utils/format';

// The server sends a batch one message at a time, so twenty members is half a minute before
// the API can answer — and the client's default ceiling is twenty seconds, which a batch
// passes routinely. The office then read "the server took too long to answer" about emails
// that were already on their way, which is indistinguishable from email that is not working.
// This is the one call in the app allowed to take minutes.
const SEND_TIMEOUT_MS = 120000;

// Who owes what, and a way to email them about it. The figures come from the
// same weekly schedule the member's own passbook shows, so a reminder can never
// claim something their statement contradicts.
export default function Reminders() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [includeLate, setIncludeLate] = useState(true);
  const [includeFines, setIncludeFines] = useState(true);
  const [note, setNote] = useState('');
  // Whether this batch may go to members who have already had this week's reminder. Off, and it
  // takes a deliberate tick: the weekly limit exists to stop the same message being sent over and
  // over, and a checkbox that was remembered between visits would quietly undo it.
  const [ignoreLimit, setIgnoreLimit] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);
  // Who has actually been emailed — the reminders from this screen and from the weekly sweep,
  // and the fine emails, which send themselves. Read from the audit trail, so it cannot report a
  // message that never went.
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [res, hist] = await Promise.all([
        api.get('/api/notifications/reminders'),
        // Never a reason to fail the page: a list of who owes what is useful on its own, and the
        // history is a second question about the same screen.
        api.get('/api/notifications/history').catch(() => null),
      ]);
      setData(res.data);
      setHistory(hist?.data || null);
      // A reload means the amounts changed — a stale selection would send an
      // email about figures nobody has looked at. The override goes the same way: it was given
      // for one batch, not for the session.
      setSelected(new Set());
      setIgnoreLimit(false);
    } catch (err) {
      setLoadError(apiMessage(err, 'Could not load outstanding balances'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const members = data?.members || [];
  const term = search.trim().toLowerCase();
  const visible = term
    ? members.filter(
        (m) =>
          m.name.toLowerCase().includes(term) ||
          String(m.regNumber || '').toLowerCase().includes(term)
      )
    : members;

  // Emailable = an address we can actually use. Opted-out members are listed so
  // the treasurer can see why they get nothing, but can't be ticked.
  //
  // A member who has already had this week's reminder is the same case: he is listed, with the
  // count that explains it, but the tick is off until the treasurer deliberately overrules the
  // limit for this batch. The API would refuse the send either way; a tick that vanishes into
  // "skipped" is worse than a tick that was never offered, because the office would think the
  // member had been told.
  const weeklyLimit = data?.weeklyLimit ?? 1;
  const atLimit = (m) => weeklyLimit > 0 && m.reminderCapReached;
  const emailable = (m) => Boolean(m.email && m.emailNotifications) && (ignoreLimit || !atLimit(m));
  const emailableVisible = visible.filter(emailable);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    if (selected.size === 0) {
      toast('Select at least one member', 'error');
      return;
    }

    setSending(true);
    setResults(null);
    try {
      const res = await api.post(
        '/api/notifications/reminders',
        {
          memberIds: [...selected],
          includeLate,
          includeFines,
          note,
          ignoreWeeklyLimit: ignoreLimit,
        },
        { timeout: SEND_TIMEOUT_MS }
      );
      setResults(res.data);
      // Two different outcomes that read the same in a bare count: a batch that sent, and a batch
      // the weekly limit held back. The second one is the one somebody needs to be told about, so
      // it says so and points at the box that clears it.
      if (res.data.sent > 0) {
        toast(res.data.sent === 1 ? '1 email sent' : `${res.data.sent} emails sent`);
      } else if (res.data.skippedByWeeklyLimit > 0) {
        toast('Nobody was emailed — they have already had this week\u2019s reminder', 'error');
      } else {
        toast('Nothing was sent — see the reasons below', 'error');
      }
      load();
    } catch (err) {
      toast(apiMessage(err, 'Could not send the reminders'), 'error');
    } finally {
      setSending(false);
    }
  }

  if (loading) return <Loader />;
  if (loadError) {
    return (
      <ErrorState
        title="Could not load who owes what"
        message={loadError}
        onRetry={load}
      />
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <BackLink to="/admin/dashboard" className="mb-2">Back</BackLink>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Reminders</p>
        <h1 className="mt-1 text-2xl font-bold">Outstanding contributions &amp; fines</h1>
        <p className="mt-1 text-sm text-muted">
          Email members who are behind on their weekly contribution, or who have unpaid fines.
          {weeklyLimit > 0 ? (
            <>
              {' '}
              Each member gets at most {weeklyLimit} reminder{weeklyLimit === 1 ? '' : 's'} a week —
              the count below is over the group&rsquo;s own week, Friday to Thursday.
            </>
          ) : (
            ' No weekly limit is set, so a member can be emailed as often as you send.'
          )}
        </p>
      </header>

      {data && !data.configured && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
          <p className="font-semibold">Email sending isn&apos;t set up yet</p>
          {/* The reason first, when there is one. A key with no provider name is set but
              unusable, and "add SMTP_HOST" would send somebody to the wrong variable. */}
          {data.problem && <p className="mt-1">{data.problem}</p>}
          <p className="mt-1 text-muted">
            On the backend, set either <span className="amount">SMTP_HOST</span> (with{' '}
            <span className="amount">SMTP_PORT</span>, <span className="amount">SMTP_USER</span>,{' '}
            <span className="amount">SMTP_PASS</span>) or{' '}
            <span className="amount">MAIL_API_PROVIDER</span> and{' '}
            <span className="amount">MAIL_API_KEY</span> — in both cases with{' '}
            <span className="amount">MAIL_FROM</span> — then restart the API. The mail API is the
            one to use on a host that blocks SMTP. Everything below still works either way; the
            send button will just report that it isn&apos;t configured.
          </p>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <div className="rounded-xl border border-rule bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Owing
            </p>
            <p className="amount mt-1 text-xl font-bold">{data.owingCount}</p>
            <p className="text-[11px] text-muted">(behind on contributions or fines)</p>
          </div>
          <div className="rounded-xl border border-rule bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Emailable
            </p>
            <p className="amount mt-1 text-xl font-bold">{data.reachableCount}</p>
            <p className="text-[11px] text-muted">(has an address, reminders on)</p>
          </div>
          <div className="rounded-xl border border-rule bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              No email
            </p>
            <p className="amount mt-1 text-xl font-bold">{data.missingEmailCount}</p>
            <p className="text-[11px] text-muted">(nothing on file, or switched off)</p>
          </div>
          {/* The new one, and the reason for this screen having a memory at all: how much of the
              week's budget has been spent. Without it a treasurer sends a second round to people
              who were emailed on Tuesday and reads the silence as the mail being broken. */}
          <div className="rounded-xl border border-rule bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Emailed this week
            </p>
            <p className="amount mt-1 text-xl font-bold">{data.emailedThisWeek}</p>
            <p className="text-[11px] text-muted">
              {weeklyLimit > 0
                ? `(${data.emailsThisWeek} email${data.emailsThisWeek === 1 ? '' : 's'}; most get ${weeklyLimit})`
                : `(${data.emailsThisWeek} email${data.emailsThisWeek === 1 ? '' : 's'}; no limit set)`}
            </p>
          </div>
          <div className="rounded-xl border border-rule bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Selected
            </p>
            <p className="amount mt-1 text-xl font-bold">{selected.size}</p>
            <p className="text-[11px] text-muted">(will get the email)</p>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-rule bg-surface p-4">
        <h2 className="text-sm font-semibold">What to include</h2>

        <div className="mt-2 space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeLate}
              onChange={(e) => setIncludeLate(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Late weekly contributions
              <span className="block text-xs text-muted">
                Weeks that have already ended without full payment. The week in progress is never
                counted as late.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeFines}
              onChange={(e) => setIncludeFines(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Unpaid fines
              <span className="block text-xs text-muted">Fines with a balance still owing.</span>
            </span>
          </label>

          {/* The way round the weekly limit, kept behind a deliberate tick. Shown only when a
              limit is actually set, because a box that does nothing is a box that teaches people
              to ignore the ones that matter. */}
          {weeklyLimit > 0 && (
            <label className="flex items-start gap-2 border-t border-rule pt-3 text-sm">
              <input
                type="checkbox"
                checked={ignoreLimit}
                onChange={(e) => setIgnoreLimit(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Send anyway to members already emailed this week
                <span className="block text-xs text-muted">
                  Off by default, and worth leaving off: each member may normally get{' '}
                  {weeklyLimit} reminder{weeklyLimit === 1 ? '' : 's'} a week
                  {data?.atCapCount > 0
                    ? `, and ${data.atCapCount} ${
                        data.atCapCount === 1 ? 'member is' : 'members are'
                      } at that limit now`
                    : ''}
                  . Tick this only to correct a mistake or to answer a member who asked to be told
                  again; every use is recorded in the audit trail.
                </span>
              </span>
            </label>
          )}
        </div>

        <label htmlFor="reminder-note" className="mt-3 block text-xs font-medium text-muted">
          Extra line (optional)
        </label>
        <textarea
          id="reminder-note"
          rows={2}
          maxLength={600}
          placeholder="e.g. Please clear your balance before the meeting on Thursday."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded-lg border border-rule bg-page px-3 py-2 text-sm"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={send}
            disabled={sending || selected.size === 0}
            className="min-h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {sending ? 'Sending…' : `Send${selected.size ? ` ${selected.size}` : ''} email${selected.size === 1 ? '' : 's'}`}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set(emailableVisible.map((m) => m.id)))}
            className="min-h-11 rounded-lg border border-rule px-4 text-sm font-medium"
          >
            Select all with email
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="min-h-11 rounded-lg border border-rule px-4 text-sm font-medium text-muted"
          >
            Clear
          </button>
        </div>
      </section>
{results && (
        <section className="rounded-xl border border-rule bg-surface p-4">
          <h2 className="text-sm font-semibold">
            Sent {results.sent} · skipped {results.skipped} · failed {results.failed}
          </h2>
          {results.skippedByWeeklyLimit > 0 && (
            <p className="mt-1 text-xs text-muted">
              {results.skippedByWeeklyLimit}{' '}
              {results.skippedByWeeklyLimit === 1 ? 'member was' : 'members were'} left out because
              they have already had this week&rsquo;s reminder
              {results.weeklyLimit > 0 ? ` (limit ${results.weeklyLimit} a week)` : ''}. Tick
              &ldquo;Send anyway…&rdquo; above to overrule that for a batch.
            </p>
          )}
          <ul className="mt-2 space-y-1 text-xs">
            {results.results.map((r) => (
              <li key={String(r.id)} className="flex items-start justify-between gap-3">
                <span className="min-w-0 truncate">
                  {r.name}
                  {r.email ? <span className="text-muted"> · {r.email}</span> : null}
                </span>
                <span
                  className={`shrink-0 font-medium ${
                    r.status === 'sent'
                      ? 'text-primary'
                      : r.status === 'failed'
                        ? 'text-alert'
                        : 'text-muted'
                  }`}
                >
                  {r.status === 'sent' ? 'Sent' : r.reason || r.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-rule bg-surface">
        <div className="border-b border-rule p-4">
          <h2 className="text-sm font-semibold">Members behind ({members.length})</h2>
          <input
            type="search"
            placeholder="Search by name or reg number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search members"
            className="mt-3 h-11 w-full rounded-lg border border-rule bg-page px-3 text-sm"
          />
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            {members.length === 0
              ? 'Nobody is behind on contributions or fines.'
              : 'No members match that search.'}
          </p>
        ) : (
          <ul className="divide-y divide-rule">
            {visible.map((m) => (
              <li key={m.id}>
                {/* The whole row is the checkbox's label. A 16px box with nothing else
                    tappable is a target nobody hits first time on a phone, and this is
                    the list the treasurer works down. */}
                <label className="flex items-start gap-3 p-4">
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggle(m.id)}
                    disabled={!emailable(m)}
                    className="mt-3 h-5 w-5 shrink-0"
                  />

                  <MemberAvatar name={m.name} photoUrl={m.photoUrl} />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {m.name}
                      {m.regNumber ? (
                        <span className="amount ml-2 text-xs font-normal text-muted">
                          {m.regNumber}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {!m.email
                        ? 'No email address on file'
                        : m.emailNotifications
                          ? m.email
                          : `${m.email} · reminders switched off`}
                    </span>
                    {/* What the row's checkbox is about to do, said before it is pressed. The
                        count is over the group's own week, so "once" here means once since
                        Friday — the same week the contributions on this row belong to. */}
                    {m.remindersThisWeek > 0 && (
                      <span
                        className={`mt-0.5 block truncate text-xs ${
                          atLimit(m) && !ignoreLimit ? 'text-alert' : 'text-accent'
                        }`}
                      >
                        {m.remindersThisWeek === 1
                          ? 'Already emailed once this week'
                          : `Already emailed ${m.remindersThisWeek} times this week`}
                        {m.lastReminderAt ? ` · last ${shortDate(m.lastReminderAt)}` : ''}
                        {atLimit(m) && !ignoreLimit ? ' · at the limit' : ''}
                      </span>
                    )}
                    <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                      {m.lateTotal > 0 && (
                        <span className="text-muted">
                          {m.lateWeeksCount} late week{m.lateWeeksCount === 1 ? '' : 's'} ·{' '}
                          <span className="amount font-medium text-ink">{money(m.lateTotal)}</span>
                        </span>
                      )}
                      {m.finesTotal > 0 && (
                        <span className="text-muted">
                          {m.finesCount} fine{m.finesCount === 1 ? '' : 's'} ·{' '}
                          <span className="amount font-medium text-ink">{money(m.finesTotal)}</span>
                        </span>
                      )}
                    </span>
                  </span>

                  <span className="amount mt-3 shrink-0 text-right text-sm font-semibold text-alert">
                    {money(m.total)}
                    <span className="block text-[11px] font-normal text-muted">owed in total</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
      {/* Who has been told what, newest first. This is the answer the office used to have to
          reconstruct from a request log, and it is the second half of the weekly limit: a cap
          whose effect nobody can see is indistinguishable from a broken send button. */}
      {history && history.entries.length > 0 && (
        <section className="rounded-xl border border-rule bg-surface">
          <div className="border-b border-rule p-4">
            <h2 className="text-sm font-semibold">Recently emailed ({history.entries.length})</h2>
            <p className="mt-1 text-xs text-muted">
              Everything this system has emailed members, newest first — the reminders sent from
              this screen and by the weekly sweep, and the two fine emails, which send themselves.
              {history.remindersThisWeek > 0
                ? ` ${history.remindersThisWeek} reminder${
                    history.remindersThisWeek === 1 ? '' : 's'
                  } since Friday.`
                : ' No reminders since Friday.'}
            </p>
          </div>
          <ul className="divide-y divide-rule">
            {history.entries.map((row) => (
              <li key={String(row.id)} className="flex items-start gap-3 p-4">
                <MemberAvatar name={row.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {row.name}
                    {row.regNumber ? (
                      <span className="amount ml-2 text-xs font-normal text-muted">
                        {row.regNumber}
                      </span>
                    ) : null}
                  </span>
                  {/* The subject is the message itself, in the group's own words — a member
                      asking "what exactly was I told?" is answered by this line, not by a
                      category. */}
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {row.kindLabel}
                    {row.subject ? ` · ${row.subject}` : ''}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {row.to ? `${row.to} · ` : ''}
                    {shortDateTime(row.sentAt)} · sent by {row.sentBy.name}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {history.total >= history.limit && (
            <p className="border-t border-rule px-4 py-3 text-xs text-muted">
              The newest {history.limit} are shown. The full record is in Audit trail (filter
              &ldquo;Notification&rdquo;) — this list is read from exactly that record.
            </p>
          )}
        </section>
      )}

    </div>
  );
}