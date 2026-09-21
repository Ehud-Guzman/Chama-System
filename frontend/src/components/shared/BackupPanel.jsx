import { useCallback, useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from './Toast';
import { shortDateTime } from '../../utils/format';

function backupFilename() {
  return `chama-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
}

export default function BackupPanel() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [statusFailed, setStatusFailed] = useState(false);

  // When a copy last left this machine, and what is on the host instead. Read-only, and the button
  // works without it: this is the context around the button, not a prerequisite for pressing it.
  const loadStatus = useCallback(async () => {
    try {
      const res = await api.get('/api/backup/status');
      setStatus(res.data);
      setStatusFailed(false);
    } catch {
      // The panel says it could not read the record rather than showing a confident blank, which is
      // the one answer that would look like "no backup has ever been taken".
      setStatusFailed(true);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

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

      // The line above the button reports this download, so it is read again now rather than
      // leaving the old date sitting there under the file that was just saved.
      loadStatus();
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
          {/* This file is the group's books and the keys to them. Saying so here is the only place
              it can be said at the moment somebody is about to send it to themselves. */}
          <p className="mt-1 text-xs text-muted">
            It holds every member&apos;s records and the admins&apos; sign-in hashes — that is what
            makes a restore possible — so keep it where only officials can reach it, and don&apos;t
            send it by email or through the group chat.
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

      {/* The difference between "we have a backup" and "the server has a file". Everything that
          makes the manual download routine workable lives in these two blocks: when a copy last
          left this machine (from the audit trail, which already records every download), and what
          is on the host — which on an ephemeral disk a redeploy takes with it. */}
      <dl className="mt-3 grid gap-3 border-t border-rule pt-3 text-xs sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Last download
          </dt>
          <dd className="mt-0.5">
            {statusFailed ? (
              <span className="text-muted">
                Could not be read just now — the audit trail has the record.
              </span>
            ) : !status ? (
              <span className="text-muted">Checking…</span>
            ) : status.lastDownload ? (
              <>
                <span className="text-ink">{shortDateTime(status.lastDownload.at)}</span>
                {status.lastDownload.by && (
                  <span className="text-muted"> by {status.lastDownload.by}</span>
                )}
                {status.lastDownload.slim && (
                  <span className="text-muted"> — data only, so not restorable on its own</span>
                )}
              </>
            ) : (
              <span className="font-medium text-alert">
                Never — nothing has been downloaded from here
              </span>
            )}
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            On the server
          </dt>
          <dd className="mt-0.5 text-muted">
            {!status ? (
              'Checking…'
            ) : status.onHost.count === 0 ? (
              'No files yet. '
            ) : (
              `${status.onHost.count} file${status.onHost.count === 1 ? '' : 's'}${
                status.onHost.newest ? `, newest ${shortDateTime(status.onHost.newest.at)}` : ''
              }, keeping the newest ${status.onHost.retention}. `
            )}
            {status &&
              (status.onHost.persistent ? (
                <span>Written to {status.onHost.directory}, which survives a redeploy.</span>
              ) : (
                <span className="text-alert">
                  Written to the app&apos;s own disk, which a redeploy empties — so it is not the
                  copy that counts.
                </span>
              ))}
          </dd>
        </div>
      </dl>
    </section>
  );
}
