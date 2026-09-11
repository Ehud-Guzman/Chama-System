import { useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from './Toast';

function backupFilename() {
  return `chama-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
}

export default function BackupPanel() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function downloadBackup() {
    setBusy(true);
    try {
      const res = await api.get('/api/backup', { responseType: 'blob' });
      const disposition = res.headers['content-disposition'] || '';
      const match = disposition.match(/filename="([^"]+)"/i);
      const filename = match?.[1] || backupFilename();
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast('Backup downloaded');
    } catch (err) {
      toast(apiMessage(err, 'Could not download backup'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-rule bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold">Backup</h2>
          <p className="mt-1 text-xs text-muted">
            Download a local JSON copy of all system collections.
          </p>
        </div>
        <button
          type="button"
          onClick={downloadBackup}
          disabled={busy}
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Preparing…' : 'Download backup'}
        </button>
      </div>
    </section>
  );
}
