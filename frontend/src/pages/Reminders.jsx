import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/shared/Toast';
import ErrorState from '../components/shared/ErrorState';
import Loader from '../components/shared/Loader';
import BackLink from '../components/shared/BackLink';
import MemberAvatar from '../components/members/MemberAvatar';
import { money } from '../utils/format';

// The server sends a batch one message at a time, so twenty members is half a minute of
// SMTP before the API can answer — and the client's default ceiling is twenty seconds,
// which a batch passes routinely. The office then read "the server took too long to
// answer" about emails that were already on their way, which is indistinguishable from
// email that is not working. This is the one call in the app allowed to take minutes; the
// test message below keeps the short ceiling, because it is one message.
const SEND_TIMEOUT_MS = 120000;

// Who owes what, and a way to email them about it. The figures come from the
// same weekly schedule the member's own passbook shows, so a reminder can never
// claim something their statement contradicts.
export default function Reminders() {
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [includeLate, setIncludeLate] = useState(true);
  const [includeFines, setIncludeFines] = useState(true);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get('/api/notifications/reminders');
      setData(res.data);
      // A reload means the amounts changed — a stale selection would send an
      // email about figures nobody has looked at.
      setSelected(new Set());
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
  const emailable = (m) => Boolean(m.email && m.emailNotifications);
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
        },
        { timeout: SEND_TIMEOUT_MS }
      );
      setResults(res.data);
      toast(res.data.sent === 1 ? '1 email sent' : `${res.data.sent} emails sent`);
      load();
    } catch (err) {
      toast(apiMessage(err, 'Could not send the reminders'), 'error');
    } finally {
      setSending(false);
    }
  }

  // The office's own check, and the only one that can tell "the variables are set" from
  // "the provider accepts us" — the difference between a screen that looks ready and a
  // member who never receives anything. When it fails, the API returns the mail server's
  // own words (a rejected password, a host that cannot reach the port), because whoever
  // presses this button is the person who can change the server's environment.
  async function sendTest() {
    setTesting(true);
    try {
      const res = await api.post('/api/notifications/test', {}, { timeout: 30000 });
      toast(`Test email sent to ${res.data.to}`);
    } catch (err) {
      toast(apiMessage(err, 'Could not send the test email'), 'error');
    } finally {
      setTesting(false);
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
        </p>
      </header>

      {data && !data.configured && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
          <p className="font-semibold">Email sending isn&apos;t set up yet</p>
          <p className="mt-1 text-muted">
            Add <span className="amount">SMTP_HOST</span>,{' '}
            <span className="amount">SMTP_PORT</span>, <span className="amount">SMTP_USER</span>,{' '}
            <span className="amount">SMTP_PASS</span> and <span className="amount">MAIL_FROM</span>{' '}
            to the backend environment and restart the API. Everything below still works — the
            send button will just report that it isn&apos;t configured.
          </p>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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

        {/* The check the office should press before blaming the reminders: one message to
            the person pressing it. Without a test, "are emails going out?" can only be
            answered by waiting to hear from a member, which is how a silent failure looks
            exactly like members who have not checked their mail. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={sendTest}
            disabled={testing}
            className="min-h-11 rounded-lg border border-rule px-4 text-sm font-medium disabled:opacity-60"
          >
            {testing ? 'Testing…' : 'Send a test email'}
          </button>
          <span className="text-xs text-muted">
            {data?.host
              ? `To ${user?.email || 'your own address'} via ${data.host}:${data.port} — press this first if reminders seem not to arrive.`
              : 'To your own address — press this first if reminders seem not to arrive.'}
          </span>
        </div>
      </section>
{results && (
        <section className="rounded-xl border border-rule bg-surface p-4">
          <h2 className="text-sm font-semibold">
            Sent {results.sent} · skipped {results.skipped} · failed {results.failed}
          </h2>
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
    </div>
  );
}