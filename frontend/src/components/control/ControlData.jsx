import { useCallback, useEffect, useRef, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../shared/Toast';
import BackupPanel from '../shared/BackupPanel';
import { shortDateTime } from '../../utils/format';
import { timeAgo } from '../../utils/timeAgo';
import { Panel, Pill, ConfirmWith, buttonClass, primaryButtonClass } from './controlUi';

// Data and recovery: the backup you download, the jobs that make the ones on the server, a way to
// read a backup file back in, and a history of what the jobs have done.
//
// The restore is the careful part. It runs in two steps: look at the file first (nothing is written
// — it says what is in it and what would change), then restore, which needs maintenance mode, the
// password and the word RESTORE, takes a safety copy first, and only ever adds and replaces — it
// never empties a collection. The destructive "replace everything" restore stays on the command
// line, where it asks for two flags.

function Jobs({ overview, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [history, setHistory] = useState(null);
  const jobs = overview.health?.jobs?.list || [];

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get('/api/superadmin/jobs/history', { params: { limit: 15 } });
      setHistory(res.data.runs);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function pause(job, paused) {
    setBusy(job.name);
    try {
      await api.put(`/api/superadmin/jobs/${job.name}`, { paused });
      toast(paused ? `${job.name} paused` : `${job.name} will run on schedule again`);
      await reload();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy('');
    }
  }

  async function runNow(job) {
    setBusy(job.name);
    try {
      await api.post(`/api/jobs/${job.name}/run`, {}, { timeout: 120000 });
      toast(`${job.name} ran`);
      await reload();
      await loadHistory();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <Panel
      title="Scheduled jobs"
      intro="The nightly backup, the weekly audit check and the Sunday reminder sweep. Pausing one skips it on schedule without stopping you running it by hand."
    >
      <ul className="divide-y divide-rule rounded-lg border border-rule">
        {jobs.map((job) => (
          <li key={job.name} className="px-3 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="min-w-0 flex-1 text-sm font-semibold">{job.name}</p>
              {job.paused ? <Pill tone="warn">Paused</Pill> : <Pill tone="good">On schedule</Pill>}
            </div>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              {job.schedule} · next in {job.nextRunIn || '—'}
              {job.lastRun
                ? ` · last ${job.lastRun.ok ? 'ran' : 'FAILED'} ${timeAgo(job.lastRun.startedAt)}`
                : ' · never run'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={busy === job.name} onClick={() => runNow(job)} className={buttonClass}>
                {busy === job.name ? 'Working…' : 'Run now'}
              </button>
              <button
                type="button"
                disabled={busy === job.name}
                onClick={() => pause(job, !job.paused)}
                className={buttonClass}
              >
                {job.paused ? 'Resume' : 'Pause'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <details className="mt-4">
        <summary className="cursor-pointer py-3 text-sm font-medium text-primary">Recent runs</summary>
        {history === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">Nothing has run yet.</p>
        ) : (
          <ul className="divide-y divide-rule rounded-lg border border-rule">
            {history.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 font-medium">{run.name}</span>
                {run.ok ? <Pill tone="good">OK</Pill> : <Pill tone="bad">Failed</Pill>}
                <span className="text-muted">{run.trigger}</span>
                <span className="amount text-muted">{shortDateTime(run.startedAt)}</span>
                {run.error && <span className="w-full text-alert">{run.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </details>
    </Panel>
  );
}

function RestoreFromBackup({ overview, reload }) {
  const toast = useToast();
  const { refreshMe } = useAuth();
  const fileRef = useRef(null);
  const [inspection, setInspection] = useState(null);
  const [chosen, setChosen] = useState(new Set());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const maintenanceOn = overview.controls.maintenance.enabled;

  async function inspect(file) {
    if (!file) return;
    setChecking(true);
    setError('');
    setResult(null);
    setInspection(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/api/superadmin/restore/inspect', form, { timeout: 120000 });
      setInspection(res.data);
      // Everything is ticked except the accounts: putting old passwords and roles back is the one
      // part of a restore that surprises people.
      setChosen(new Set(res.data.plan.filter((row) => row.name !== 'users').map((row) => row.name)));
    } catch (err) {
      setError(apiMessage(err, 'That file could not be read'));
    } finally {
      setChecking(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function toggle(name) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function restore({ phrase, password }) {
    try {
      const res = await api.post(
        '/api/superadmin/restore/apply',
        { uploadId: inspection.uploadId, collections: [...chosen], phrase, password },
        { timeout: 300000 }
      );
      setResult(res.data);
      setInspection(null);
      toast(res.data.ok ? 'Restored' : 'Restored with problems — read the log', res.data.ok ? 'success' : 'error');
      setConfirming(false);
      await reload();
      await refreshMe().catch(() => {});
    } catch (err) {
      throw new Error(apiMessage(err));
    }
  }

  return (
    <Panel
      title="Restore from a backup"
      intro="Read a backup file back in. First you only look: nothing is written until you confirm. A restore adds what is missing and replaces what the file also holds — it never empties anything — and a safety copy of today is written first."
    >
      {!maintenanceOn && (
        <p className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm leading-6 text-accent">
          Switch on maintenance mode (Switches) before restoring, so nobody saves anything in the middle.
          You can look at a file now; you cannot restore until it is on.
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        onChange={(e) => inspect(e.target.files?.[0])}
        className="hidden"
        id="restore-file"
      />
      <label htmlFor="restore-file" className={`${buttonClass} inline-flex cursor-pointer items-center`}>
        {checking ? 'Reading the file…' : 'Choose a backup file to look at'}
      </label>
      <p className="mt-1 text-xs text-muted">The files from the Backup button above, or from the server&apos;s nightly job.</p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-alert/40 bg-alert/5 px-3 py-2 text-sm text-alert">
          {error}
        </p>
      )}

      {inspection && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-rule bg-canvas p-3 text-sm leading-6">
            <p>
              <strong>{inspection.file.name}</strong> · {inspection.file.sizeMb} MB
            </p>
            <p className="text-muted">
              Taken {inspection.file.takenAt ? shortDateTime(inspection.file.takenAt) : 'at an unknown time'}
              {inspection.file.by ? ` by ${inspection.file.by}` : ''}.
            </p>
          </div>

          {inspection.warnings.map((warning) => (
            <p key={warning} className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm leading-6 text-accent">
              {warning}
            </p>
          ))}

          <div className="scroll-x rounded-lg border border-rule">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead>
                <tr className="border-b border-rule bg-canvas text-xs uppercase tracking-wider text-muted">
                  <th className="px-3 py-2 font-semibold">Restore</th>
                  <th className="px-3 py-2 text-right font-semibold">In the file</th>
                  <th className="px-3 py-2 text-right font-semibold">Now</th>
                  <th className="px-3 py-2 text-right font-semibold">Would add</th>
                  <th className="px-3 py-2 text-right font-semibold">Would replace</th>
                </tr>
              </thead>
              <tbody>
                {inspection.plan.map((row) => (
                  <tr key={row.name} className="border-b border-rule last:border-b-0">
                    <td className="px-3 py-1">
                      <label className="flex min-h-11 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={chosen.has(row.name)}
                          onChange={() => toggle(row.name)}
                          className="h-4 w-4"
                        />
                        <span className="font-medium">{row.name}</span>
                      </label>
                    </td>
                    <td className="amount px-3 py-1 text-right">{row.inFile}</td>
                    <td className="amount px-3 py-1 text-right text-muted">{row.inDatabase}</td>
                    <td className="amount px-3 py-1 text-right">{row.wouldAdd}</td>
                    <td className={`amount px-3 py-1 text-right ${row.wouldReplace ? 'text-accent' : 'text-muted'}`}>
                      {row.wouldReplace}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={!maintenanceOn || chosen.size === 0}
            onClick={() => setConfirming(true)}
            className={primaryButtonClass}
          >
            Restore {chosen.size} collection{chosen.size === 1 ? '' : 's'}…
          </button>
        </div>
      )}

      {result && (
        <div
          role="status"
          className={`mt-4 rounded-lg border px-3 py-3 text-sm leading-6 ${
            result.ok ? 'border-primary/30 bg-primary/5' : 'border-alert/40 bg-alert/5'
          }`}
        >
          <p className="font-semibold">{result.note}</p>
          <p className="text-muted">
            {result.inserted} added, {result.replaced} replaced. Safety copy: {result.safetyCopy}.
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs font-medium text-primary">The log</summary>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap text-xs">{result.log.join('\n')}</pre>
          </details>
        </div>
      )}

      <ConfirmWith
        open={confirming}
        title="Restore from this file?"
        body={
          <>
            <p>
              {chosen.size} collection{chosen.size === 1 ? '' : 's'} will be written from the file. Rows the
              file also holds are replaced by the file&apos;s version. A safety copy of the database as it is now
              is written first.
            </p>
          </>
        }
        confirmLabel="Restore"
        danger
        needs={{ phrase: inspection?.phrase || 'RESTORE', password: true }}
        onCancel={() => setConfirming(false)}
        onConfirm={restore}
      />
    </Panel>
  );
}

export default function ControlData({ overview, reload }) {
  return (
    <div id="data" className="scroll-mt-24 space-y-4">
      <BackupPanel />
      <RestoreFromBackup overview={overview} reload={reload} />
      <Jobs overview={overview} reload={reload} />
    </div>
  );
}
