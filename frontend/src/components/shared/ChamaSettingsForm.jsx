import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from './Toast';

// Edits the one thing shown on the public overview beyond live numbers:
// the chama's name. Any admin can update it — it's identity, not security.
export default function ChamaSettingsForm() {
  const toast = useToast();
  const [chamaName, setChamaName] = useState('');
  const [constitution, setConstitution] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .get('/api/settings')
      .then((res) => {
        setChamaName(res.data.settings.chamaName);
        setConstitution(res.data.settings.constitution || '');
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/api/settings', { chamaName, constitution });
      toast('Settings updated');
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <section className="rounded-xl border border-rule bg-surface p-5">
      <h2 className="text-base font-semibold">Chama name</h2>
      <p className="mt-1 text-xs text-muted">Shown to every member on the public lookup page.</p>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <input
          type="text"
          required
          value={chamaName}
          onChange={(e) => setChamaName(e.target.value)}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Chama name"
        />

        <div className="border-t border-rule pt-3">
          <label htmlFor="constitution" className="text-sm font-medium">
            Constitution
          </label>
          <p className="mt-1 text-xs text-muted">Shown on the public constitution page.</p>
          <textarea
            id="constitution"
            rows={8}
            value={constitution}
            onChange={(e) => setConstitution(e.target.value)}
            placeholder="Paste or write the chama's constitution here…"
            className="mt-2 w-full rounded-xl border border-rule px-4 py-3 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </section>
  );
}
