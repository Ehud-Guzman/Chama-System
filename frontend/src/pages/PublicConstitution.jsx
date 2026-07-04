import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import Loader from '../components/shared/Loader';

// Reuses the same public overview payload GroupOverview already fetches on
// the home page — no separate endpoint needed since the constitution text
// rarely changes.
export default function PublicConstitution() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/api/public/overview')
      .then((res) => setOverview(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-dvh px-4 py-10 md:px-8">
      <main className="mx-auto w-full max-w-3xl">
        <Link to="/" className="text-sm font-medium text-primary">
          ← Back
        </Link>
        <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-muted">
          {overview?.chamaName || 'Contribution Manager'}
        </p>
        <h1 className="mt-1 text-2xl font-bold">Constitution</h1>

        {loading ? (
          <Loader />
        ) : overview?.constitution ? (
          <div className="mt-6 whitespace-pre-wrap rounded-xl border border-rule bg-surface p-5 text-sm leading-relaxed">
            {overview.constitution}
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
            The constitution hasn't been published yet.
          </p>
        )}
      </main>
    </div>
  );
}
