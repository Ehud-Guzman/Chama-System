import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api, { apiMessage } from '../services/api';
import PassbookCard from '../components/public/PassbookCard';
import Loader from '../components/shared/Loader';

// Reached by browsing the directory rather than typing a phone number —
// same public passbook view, just a different way in.
export default function PublicMemberDetail() {
  const { id } = useParams();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    setResult(null);
    api
      .get(`/api/public/directory/${id}`)
      .then((res) => setResult(res.data))
      .catch((err) => {
        setError(err.response?.status === 404 ? 'not_found' : apiMessage(err));
      })
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="min-h-dvh px-4 py-10">
      <main className="mx-auto w-full max-w-[420px]">
        <Link to="/" className="text-sm font-medium text-primary">
          ← All members
        </Link>

        {loading && <Loader />}

        {!loading && error === 'not_found' && (
          <div className="mt-8 rounded-xl border border-rule bg-surface px-5 py-8 text-center">
            <p className="font-semibold">Member not found</p>
            <p className="mt-2 text-sm text-muted">They may have left the group.</p>
          </div>
        )}

        {!loading && error && error !== 'not_found' && (
          <p className="mt-8 text-center text-sm font-medium text-alert" role="alert">
            {error}
          </p>
        )}

        {!loading && result && (
          <div className="mt-6">
            <PassbookCard key={id} result={result} />
          </div>
        )}
      </main>
    </div>
  );
}
