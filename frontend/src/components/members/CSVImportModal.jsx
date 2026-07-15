import { useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useModal } from '../../hooks/useModal';

// Reads the CSV file in the browser and posts its text — no multipart upload needed.
export default function CSVImportModal({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const containerRef = useModal(true, onClose);

  async function onSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const csv = await file.text();
      const res = await api.post('/api/members/import', { csv });
      setResult(res.data);
      if (res.data.imported > 0) onImported();
    } catch (err) {
      setError(apiMessage(err, 'Import failed. Check the file and try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Import members from CSV"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div ref={containerRef} className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-xl bg-surface p-5 shadow-xl">
        <h2 className="text-base font-semibold">Import members from CSV</h2>
        <p className="mt-1 text-xs text-muted">
          Columns: <span className="amount">name, phone, regNumber, notes</span> — regNumber and
          notes are optional. Duplicate phone numbers are skipped, never overwritten.
        </p>

        {!result ? (
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <input
              type="file"
              accept=".csv,text/csv"
              required
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-canvas file:px-4 file:text-sm file:font-medium"
              aria-label="CSV file"
            />
            {error && (
              <p className="text-sm font-medium text-alert" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="min-h-12 flex-1 rounded-xl border border-rule text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !file}
                className="min-h-12 flex-1 rounded-xl bg-primary text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4">
            <p className="text-sm font-medium">
              Imported {result.imported} · Skipped {result.skipped}
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-canvas p-3 text-xs">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    <span className="font-semibold">Row {e.row}:</span> {e.reason}
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-4 min-h-12 w-full rounded-xl bg-primary text-sm font-semibold text-white"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
