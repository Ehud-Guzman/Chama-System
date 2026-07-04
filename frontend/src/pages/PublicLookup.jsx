import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import GroupOverview from '../components/public/GroupOverview';
import PassbookCard from '../components/public/PassbookCard';
import DirectoryList from '../components/public/DirectoryList';

// Mirrors the backend normalizer for instant client-side validation
function normalizePhone(input) {
  let digits = String(input).replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 12 && digits.startsWith('254')) digits = '0' + digits.slice(3);
  else if (digits.length === 9 && /^[17]/.test(digits)) digits = '0' + digits;
  return /^0[17]\d{8}$/.test(digits) ? digits : null;
}

export default function PublicLookup() {
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | found | notFound | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [chamaName, setChamaName] = useState('');
  const onChamaName = useCallback((name) => setChamaName(name), []);

  async function onSubmit(e) {
    e.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setStatus('error');
      setError('Enter a valid phone number, e.g. 0712 345 678');
      return;
    }
    setStatus('loading');
    setError('');
    setResult(null);
    try {
      const res = await api.get('/api/public/lookup', { params: { phone: normalized } });
      setResult(res.data);
      setStatus('found');
    } catch (err) {
      if (err.response?.status === 404) {
        setStatus('notFound');
      } else {
        setStatus('error');
        setError(apiMessage(err, 'Could not check right now. Please try again.'));
      }
    }
  }

  return (
    <div className="min-h-dvh px-4 py-10 md:px-8">
      {/* Page widens on desktop; the hero/search stays a focused narrow
          column inside it, everything below (overview, directory) uses
          the full width. */}
      <main className="mx-auto w-full max-w-105 md:max-w-6xl">
        <div className="md:mx-auto md:max-w-105">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">
            {chamaName || 'Contribution Manager'}
          </p>
          <h1 className="mt-2 text-3xl font-bold leading-tight">Check your contributions</h1>
          <p className="mt-2 text-sm text-muted">
            An open book — see what the group has raised, then find your own record below.
          </p>

          <form onSubmit={onSubmit} className="mt-6">
            <label htmlFor="phone" className="sr-only">
              Phone number
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="07XX XXX XXX"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (status === 'error') setStatus('idle');
              }}
              className="amount h-14 w-full rounded-xl border border-rule bg-surface px-4 text-lg"
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="mt-3 h-14 w-full rounded-xl bg-primary text-base font-semibold text-white disabled:opacity-60"
            >
              {status === 'loading' ? 'Checking…' : 'Check contributions'}
            </button>
            {status === 'error' && (
              <p className="mt-3 text-sm font-medium text-alert" role="alert">
                {error}
              </p>
            )}
          </form>

          {status === 'notFound' && (
            <div className="mt-6 rounded-xl border border-rule bg-surface px-5 py-8 text-center">
              <p className="font-semibold">No record found for that number</p>
              <p className="mt-2 text-sm text-muted">
                Number not registered? Contact your treasurer.
              </p>
            </div>
          )}

          {status === 'found' && result && (
            <div className="mt-6">
              <PassbookCard key={result.regNumber || result.name} result={result} />
            </div>
          )}
        </div>

        <div className="mt-10">
          <GroupOverview onChamaName={onChamaName} />
        </div>

        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
            All members
          </h2>
          <p className="mt-1 text-sm text-muted">
            Browse the full membership — open to everyone, no login required.
          </p>
          <div className="mt-4">
            <DirectoryList />
          </div>
        </section>

        <p className="mt-12 text-center">
          <Link to="/admin/login" className="text-xs text-muted underline-offset-2 hover:underline">
            Admin sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
