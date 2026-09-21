import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiMessage } from '../services/api';
import { roleHome } from '../utils/roleHome';
import { CHAMA_NAME } from '../utils/branding';
import CreditLine from '../components/shared/CreditLine';

// The sign-in, in one or two steps.
//
// When the account has two-factor authentication on, the API answers the password with a
// five-minute challenge instead of a session, and this screen asks for the code. It is the same
// page rather than a second route on purpose: a separate `/admin/2fa` would be a URL somebody
// could land on with no challenge in hand, and the state that matters — "the password was right,
// the code is not given yet" — lives in this component's own state and nowhere else.
export default function AdminLogin() {
  const { login, completeTwoFactor } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function onPasswordSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await login(email, password);
      if (result.twoFactorRequired) {
        setChallenge({ token: result.challenge, email: result.email });
        setCode('');
        return;
      }
      navigate(roleHome(result.user.role), { replace: true });
    } catch (err) {
      setError(apiMessage(err, 'Could not sign in. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function onCodeSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await completeTwoFactor(challenge.token, code.trim());
      if (result.usedRecoveryCode) {
        // Said out loud rather than silently accepted: the code he typed no longer works, and if he
        // is down to his last one he needs to know that before he is locked out.
        setNotice(
          `Signed in with a recovery code. ${
            result.recoveryCodesRemaining === 0
              ? 'That was the last one — issue a new set from Settings → Security.'
              : `${result.recoveryCodesRemaining} left.`
          }`
        );
      }
      navigate(roleHome(result.user.role), { replace: true });
    } catch (err) {
      setError(apiMessage(err, 'That code was not accepted. Please try again.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh px-4 py-10">
      <main className="mx-auto w-full max-w-[420px]">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          {CHAMA_NAME}
        </p>
        <h1 className="mt-2 text-3xl font-bold">
          {challenge ? 'Enter your code' : 'Admin sign in'}
        </h1>

        {notice && (
          <p className="mt-3 rounded-xl border border-rule bg-surface p-3 text-sm" role="status">
            {notice}
          </p>
        )}

        {!challenge && (
          <form onSubmit={onPasswordSubmit} className="mt-6 space-y-3">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 w-full rounded-xl border border-rule bg-surface px-4"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              disabled={busy}
              className="h-14 w-full rounded-xl bg-primary text-base font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {challenge && (
          <form onSubmit={onCodeSubmit} className="mt-6 space-y-3">
            <p className="text-sm leading-6 text-muted">
              Two-factor authentication is on for <strong>{challenge.email}</strong>. Open your
              authenticator app and type the six-digit code it shows now.
            </p>
            <div>
              <label htmlFor="code" className="mb-1 block text-sm font-medium">
                Six-digit code
              </label>
              <input
                id="code"
                // Not `type="number"`: it brings a spinner and a scroll-wheel that silently
                // changes a code somebody has already typed correctly. `inputMode` gets the digits
                // keypad on a phone without any of that.
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                // Long enough for a recovery code too, because a lost phone is the case this screen
                // has to survive, and making him go back to the password first is just friction.
                maxLength={11}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="h-14 w-full rounded-xl border border-rule bg-surface px-4 text-center text-2xl tracking-[0.3em]"
                placeholder="000000"
              />
              <p className="mt-2 text-xs leading-5 text-muted">
                Lost the phone? Type one of your recovery codes instead.
              </p>
            </div>
            {error && (
              <p className="text-sm font-medium text-alert" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="h-14 w-full rounded-xl bg-primary text-base font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Checking…' : 'Continue'}
            </button>
            <button
              type="button"
              onClick={() => {
                // Back to the password step. The challenge is dropped rather than kept: it is good
                // for five minutes, and leaving it in state invites a half-finished sign-in that
                // nobody can explain afterwards.
                setChallenge(null);
                setCode('');
                setError('');
                setPassword('');
              }}
              className="min-h-11 w-full rounded-xl border border-rule text-sm font-semibold"
            >
              Use a different account
            </button>
          </form>
        )}

        <p className="mt-12 text-center">
          <Link to="/" className="text-xs text-muted underline-offset-2 hover:underline">
            Member lookup
          </Link>
        </p>

        <CreditLine className="mt-4 text-center" />
      </main>
    </div>
  );
}
