import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from './Toast';
import { useAuth } from '../../context/AuthContext';

// Two-factor authentication, on your own account.
//
// The reason this exists: an admin account moves a member's money, and until now the only thing
// between a password and the books was the password — something that can be read over a shoulder,
// guessed, or reused from an older leak. A six-digit code that changes every thirty seconds and
// lives on a different device cannot be.
//
// **No QR code, deliberately.** Every "scan this" flow on the web sends the shared secret to some
// third-party image service to be drawn, and that secret *is* the account's security — sending it
// to a stranger to render a picture is a bad trade for one saved line of typing. Every
// authenticator app supports manual key entry, so the key is shown grouped and copyable, and the
// `otpauth://` link is offered for apps that accept a pasted URI.
export default function TwoFactorPanel() {
  const toast = useToast();
  const { user } = useAuth();

  const enabled = Boolean(user?.twoFactorEnabled);
  // Whether the group is using it at all. Read from the API rather than guessed, because the
  // server is what decides: with the switch off, no code is ever asked for at sign-in.
  const [groupEnabled, setGroupEnabled] = useState(null);
  const [enrolledCount, setEnrolledCount] = useState(null);
  const [switching, setSwitching] = useState(false);
  const isSuperAdmin = user?.role === 'super_admin';

  const [setup, setSetup] = useState(null); // { secret, otpauthUrl, issuer }
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [savedCodes, setSavedCodes] = useState(false);
  const [form, setForm] = useState({ password: '', code: '' });
  const [busy, setBusy] = useState(false);

  // The switch, and - for the super admin - how many accounts turning it on would affect. That
  // number is the whole reason this is its own call: flipping it changes what other people must do
  // to sign in, and nobody should do that without seeing who it lands on.
  const loadState = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me');
      setGroupEnabled(Boolean(res.data.twoFactorAuthEnabled));
    } catch {
      setGroupEnabled(false);
    }
    if (isSuperAdmin) {
      try {
        const admins = await api.get('/api/auth/admins');
        setEnrolledCount((admins.data.admins || []).filter((a) => a.twoFactorEnabled).length);
      } catch {
        setEnrolledCount(null);
      }
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  async function setGroupSwitch(next) {
    setSwitching(true);
    try {
      await api.patch('/api/settings', { twoFactorAuthEnabled: next });
      setGroupEnabled(next);
      // Turning it off while somebody is half-enrolled would leave them holding a key that does
      // nothing, so any enrolment in progress is dropped here too.
      if (!next) setSetup(null);
      toast(next ? 'Two-factor authentication is on for the group' : 'Two-factor authentication is off');
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setSwitching(false);
    }
  }

  async function beginSetup() {
    setBusy(true);
    try {
      const res = await api.post('/api/auth/me/2fa/setup');
      setSetup(res.data);
      setCode('');
      setRecoveryCodes(null);
      setSavedCodes(false);
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post('/api/auth/me/2fa/enable', { code: code.trim() });
      setRecoveryCodes(res.data.recoveryCodes);
      setSetup(null);
      setCode('');
      toast('Two-factor authentication is on');
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await api.post('/api/auth/me/2fa/disable', form);
      setForm({ password: '', code: '' });
      setRecoveryCodes(null);
      toast('Two-factor authentication is off');
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reissueCodes() {
    setBusy(true);
    try {
      const res = await api.post('/api/auth/me/2fa/recovery-codes', form);
      setRecoveryCodes(res.data.recoveryCodes);
      setSavedCodes(false);
      setForm({ password: '', code: '' });
      toast('New recovery codes issued');
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      // A browser that refuses clipboard access is common enough that failing silently would look
      // like a broken button. The text is on screen to select by hand.
      toast('Could not copy — select the text and copy it by hand', 'error');
    }
  }

  return (
    <section className="min-w-0 rounded-xl border border-rule bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Two-factor authentication</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            A second step at sign-in, from an authenticator app on your phone. Worth having on any
            account that can change the books.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            groupEnabled ? (enabled ? 'bg-primary/10 text-primary' : 'border border-rule text-muted') : 'border border-rule text-muted'
          }`}
        >
          {groupEnabled ? (enabled ? 'On for your account' : 'Off for your account') : 'Off for the group'}
        </span>
      </div>

      {/* --- the group switch. Super admin only, because it changes what everybody else must do to
              sign in. Off by default: nothing here has any effect until this is turned on. --- */}
      {isSuperAdmin && groupEnabled !== null && (
        <div className="mt-4 rounded-xl border border-rule bg-bg p-4">
          <h3 className="text-sm font-semibold">Is the group using it?</h3>
          <p className="mt-1 text-sm leading-6 text-muted">
            Switching this off means nobody is asked for a code at sign-in - including accounts that
            have already set it up. Their setup is kept, not deleted, so switching it back on
            restores exactly what was there.
            {groupEnabled && enrolledCount !== null && enrolledCount > 0 && (
              <>
                {' '}
                <strong>
                  {enrolledCount} {enrolledCount === 1 ? 'account has' : 'accounts have'}
                </strong>{' '}
                it set up right now, so turning it off affects {enrolledCount === 1 ? 'that one' : 'those'}.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => setGroupSwitch(!groupEnabled)}
            disabled={switching}
            className={`mt-3 min-h-12 rounded-xl px-5 text-sm font-semibold disabled:opacity-60 ${
              groupEnabled ? 'border border-alert text-alert' : 'bg-primary text-white'
            }`}
          >
            {switching
              ? 'Saving…'
              : groupEnabled
                ? 'Turn two-factor authentication OFF for the group'
                : 'Turn two-factor authentication ON for the group'}
          </button>
        </div>
      )}

      {/* --- when the group has it off, there is nothing for anybody else to do here --- */}
      {groupEnabled === false && (
        <p className="mt-4 rounded-xl border border-rule bg-bg p-4 text-sm leading-6 text-muted">
          Two-factor authentication is switched off for this group, so no code is asked for at
          sign-in.
          {isSuperAdmin
            ? ' Turning it on above is what puts it into use.'
            : ' The super admin can turn it on in Settings → Security if the committee decides to use it.'}
        </p>
      )}

      {enabled && user?.twoFactorEnrolledAt && (
        <p className="mt-2 text-xs text-muted">
          Turned on {new Date(user.twoFactorEnrolledAt).toLocaleDateString()}.
        </p>
      )}

      {/* --- the codes, shown once and never again --- */}
      {recoveryCodes && (
        <div className="mt-4 rounded-xl border border-rule bg-bg p-4">
          <h3 className="text-sm font-semibold">Your recovery codes</h3>
          <p className="mt-1 text-sm leading-6 text-muted">
            Each one lets you sign in once if the phone is lost. They are shown here and nowhere
            else — the server keeps only a hash — so write them down now and keep them somewhere
            other than the phone.
          </p>
          <ul className="mt-3 grid gap-1 font-mono text-sm sm:grid-cols-2">
            {recoveryCodes.map((recovery) => (
              <li key={recovery} className="rounded-lg border border-rule px-3 py-2">
                {recovery}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copy(recoveryCodes.join('\n'), 'Codes')}
              className="min-h-11 rounded-xl border border-rule px-4 text-sm font-semibold"
            >
              Copy all
            </button>
            <button
              type="button"
              onClick={() => setSavedCodes(true)}
              className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-white"
            >
              I have written them down
            </button>
          </div>
          {savedCodes && (
            <p className="mt-3 text-sm font-medium text-primary" role="status">
              Good. Use one of those if you ever lose the phone.
            </p>
          )}
        </div>
      )}

      {!enabled && !setup && !recoveryCodes && groupEnabled && (
        <button
          type="button"
          onClick={beginSetup}
          disabled={busy}
          className="mt-4 min-h-12 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Preparing…' : 'Turn on two-factor authentication'}
        </button>
      )}

      {/* --- enrolment, in two steps, with nothing switched on until step 2 works --- */}
      {setup && (
        <form onSubmit={confirmSetup} className="mt-4 space-y-3 rounded-xl border border-rule bg-bg p-4">
          <h3 className="text-sm font-semibold">1. Add this key to your authenticator app</h3>
          <p className="text-sm leading-6 text-muted">
            In the app choose &ldquo;add account&rdquo;, then the option to enter a key by hand —
            in Google Authenticator that is <strong>+ → Enter a setup key</strong>. Tap{' '}
            <strong>Copy</strong> below and paste it into the <em>Key</em> box, then give it a name
            so you know what it is later: <strong>{setup.issuer}</strong>.
          </p>
          {/* The key is shown as one run of characters, with no spaces, because that is the only
              form the manual-entry field of an authenticator app accepts. It used to be displayed
              grouped in fours for readability — which looked friendlier and was actively harmful:
              Google Authenticator answers a space with "key value has illegal character", so
              anybody who typed what was on the screen failed, and the screen never said why. There
              is no grouped version any more; copy it, or type the characters exactly as they are. */}
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg border border-rule bg-surface px-3 py-2 font-mono text-sm break-all">
              {setup.secret}
            </code>
            <button
              type="button"
              onClick={() => copy(setup.secret, 'Key')}
              className="min-h-11 rounded-xl border border-rule px-4 text-sm font-semibold"
            >
              Copy
            </button>
          </div>
          <p className="text-xs leading-5 text-muted">
            Enter it exactly as it is, with no spaces. If the app says the key has an illegal
            character, it is almost always a space or a line break that came along with it — tap
            Copy rather than selecting the text by hand.
          </p>
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer leading-[2.75rem] text-muted">
              Some apps accept a link instead — not Google Authenticator
            </summary>
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 rounded-lg border border-rule bg-surface px-3 py-2 font-mono text-xs break-all">
                  {setup.otpauthUrl}
                </code>
                <button
                  type="button"
                  onClick={() => copy(setup.otpauthUrl, 'Link')}
                  className="min-h-11 rounded-xl border border-rule px-4 text-sm font-semibold"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs leading-5 text-muted">
                This link goes in an app that offers &ldquo;add from a link or URI&rdquo; — 1Password
                and Bitwarden do. Google Authenticator and Authy do not: they only take the key
                above, and pasting this link into their key box is what produces the illegal
                character message.
              </p>
            </div>
          </details>

          <h3 className="pt-1 text-sm font-semibold">2. Type the code it shows now</h3>
          <p className="text-sm leading-6 text-muted">
            Nothing has changed yet — if you close this page now, your account is exactly as it was.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-14 w-full rounded-xl border border-rule bg-surface px-4 text-center text-2xl tracking-[0.3em]"
            placeholder="000000"
            aria-label="Six-digit code from your authenticator app"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-12 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Checking…' : 'Turn it on'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSetup(null);
                setCode('');
              }}
              className="min-h-12 rounded-xl border border-rule px-5 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* --- turning it off, and new codes: both need the password *and* a live code --- */}
      {enabled && !recoveryCodes && (
        <div className="mt-4 space-y-3">
          <p className="text-sm leading-6 text-muted">
            Both buttons below need your password <em>and</em> a current code. One alone is something
            a thief holding the phone already has — the password is written in his notes, and the
            authenticator app is unlocked on the phone he is holding.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="password"
              autoComplete="current-password"
              required
              placeholder="Your password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
              aria-label="Your password"
            />
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              placeholder="Current 6-digit code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
              aria-label="Current six-digit code"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Issuing new codes is refused while the group has the feature off, so the button is
                not offered: a button that always fails is worse than no button. Turning the second
                factor off stays available - an account that wants out must be able to get out. */}
            {groupEnabled && (
              <button
                type="button"
                onClick={reissueCodes}
                disabled={busy || !form.password || !form.code}
                className="min-h-12 rounded-xl border border-rule px-5 text-sm font-semibold disabled:opacity-60"
              >
                Issue new recovery codes
              </button>
            )}
            <button
              type="button"
              onClick={turnOff}
              disabled={busy || !form.password || !form.code}
              className="min-h-12 rounded-xl border px-5 text-sm font-semibold text-alert disabled:opacity-60"
            >
              Turn it off
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

