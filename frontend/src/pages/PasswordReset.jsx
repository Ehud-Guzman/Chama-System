import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import { CHAMA_NAME } from '../utils/branding';
import CreditLine from '../components/shared/CreditLine';

// Forgotten passwords, by email: asking for the link, and choosing a new password from it.
//
// One page for both steps, told apart by whether the address carries a `token`, because the emailed
// link is the only way to the second step and the sign-in page is the only way to the first.
// Nothing here ever says whether an address has an account: asking always ends on the same
// sentence, so the page cannot be used to find out who holds one.
export default function PasswordReset() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  return token ? <ChooseNewPassword token={token} /> : <AskForLink />;
}

function Shell({ title, children }) {
  return (
    <div className="min-h-dvh px-4 py-10">
      <main className="mx-auto w-full max-w-[420px]">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">{CHAMA_NAME}</p>
        <h1 className="mt-2 text-3xl font-bold">{title}</h1>
        {children}
        <p className="mt-6">
          <Link to="/admin/login" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline">
            Back to sign in
          </Link>
        </p>
        <CreditLine className="mt-10" />
      </main>
    </div>
  );
}

function AskForLink() {
  const [email, setEmail] = useState('');
  const [available, setAvailable] = useState(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/api/auth/password-reset/available')
      .then((res) => setAvailable(Boolean(res.data.available)))
      .catch(() => setAvailable(true));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/api/auth/forgot-password', { email: email.trim() });
      setAnswer(res.data.message);
    } catch (err) {
      setError(apiMessage(err, 'Could not send that right now. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Forgot your password?">
      {available === false ? (
        <p className="mt-4 rounded-xl border border-rule bg-surface p-4 text-sm leading-6">
          Email is not set up on this system, so a link cannot be sent. Ask another admin to reset your
          password from Settings, under Accounts.
        </p>
      ) : answer ? (
        <p className="mt-4 rounded-xl border border-rule bg-surface p-4 text-sm leading-6" role="status">
          {answer} Check your spam folder if it does not arrive in a few minutes.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <p className="text-sm leading-6 text-muted">
            Enter the email you sign in with. If it belongs to an account, we send a link to choose a new
            password.
          </p>
          <div>
            <label htmlFor="reset-email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full rounded-xl border border-rule bg-surface px-4"
            />
          </div>
          {error && (
            <p className="text-sm font-medium text-alert" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || available === null}
            className="h-14 w-full rounded-xl bg-primary text-base font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Sending…' : 'Send me a link'}
          </button>
        </form>
      )}
    </Shell>
  );
}

function ChooseNewPassword({ token }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (password !== again) {
      setError('The two passwords are not the same.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(apiMessage(err, 'Could not change the password. Please ask for a new link.'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell title="Password changed">
        <p className="mt-4 rounded-xl border border-rule bg-surface p-4 text-sm leading-6" role="status">
          Your password has been changed and every other sign-in of yours has been ended. Sign in with the
          new one.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Choose a new password">
      <form onSubmit={submit} className="mt-6 space-y-3">
        <p className="text-sm leading-6 text-muted">At least 8 characters, with letters and numbers.</p>
        <div>
          <label htmlFor="new-password" className="mb-1 block text-sm font-medium">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 w-full rounded-xl border border-rule bg-surface px-4"
          />
        </div>
        <div>
          <label htmlFor="new-password-again" className="mb-1 block text-sm font-medium">
            New password again
          </label>
          <input
            id="new-password-again"
            type="password"
            autoComplete="new-password"
            required
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            className="h-12 w-full rounded-xl border border-rule bg-surface px-4"
          />
        </div>
        {error && (
          <p className="text-sm font-medium text-alert" role="alert">
            {error}{' '}
            {/expired|already used|not valid/i.test(error) && (
              <Link to="/admin/forgot-password" className="underline">
                Ask for a new link
              </Link>
            )}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="h-14 w-full rounded-xl bg-primary text-base font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </Shell>
  );
}
