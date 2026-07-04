import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiMessage } from '../services/api';

export default function AdminLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(apiMessage(err, 'Could not sign in. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh px-4 py-10">
      <main className="mx-auto w-full max-w-[420px]">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          Contribution Manager
        </p>
        <h1 className="mt-2 text-3xl font-bold">Admin sign in</h1>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
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

        <p className="mt-12 text-center">
          <Link to="/" className="text-xs text-muted underline-offset-2 hover:underline">
            Member lookup
          </Link>
        </p>
      </main>
    </div>
  );
}
