import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { shortDateTime } from '../../utils/format';
import { blobErrorMessage } from '../../utils/blobError';
import { Panel, Field, inputClass, buttonClass } from './controlUi';

// The audit powers above the ordinary trail.
//
// The audit screen everybody else uses shows who did what and what moved; it never sends the
// stored snapshots (they hold whole member records). You can: open any entry exactly as stored,
// see which address it came from, flag one for a second look and clear it later, search by
// address, and download the whole trail with its hashes so the chain can be checked independently.

function entityLabel(entityType) {
  return String(entityType || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

export default function ControlAudit({ onChanged }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [flagged, setFlagged] = useState(null);
  const [ip, setIp] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/superadmin/audit-reviews');
      setFlagged(res.data.flagged);
    } catch (err) {
      setFlagged([]);
      toast(apiMessage(err, 'Could not load the flagged entries'), 'error');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function clear(entry) {
    try {
      await api.post(`/api/superadmin/audit/${entry.id}/review`, { status: 'cleared', note: 'Looked at, fine' });
      toast('Cleared');
      await load();
      onChanged?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    }
  }

  async function downloadFull() {
    setBusy(true);
    try {
      const res = await api.get('/api/superadmin/export/audit', { responseType: 'blob', timeout: 120000 });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-trail-full-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('The full audit trail was downloaded');
    } catch (err) {
      toast(await blobErrorMessage(err, 'Could not download the audit trail'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      id="audit"
      title="Audit powers"
      intro="Open any entry in the audit trail to read it exactly as stored — the whole before and after, the chain hash and the address it came from — and flag it for a second look."
      right={
        <Link to="/admin/audit" className={`${buttonClass} flex items-center`}>
          Open the audit trail
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">Flagged for review</h3>
          {flagged === null ? (
            <p className="mt-2 text-sm text-muted">Loading…</p>
          ) : flagged.length === 0 ? (
            <p className="mt-2 rounded-lg border border-rule px-3 py-3 text-sm text-muted">
              Nothing flagged. In the audit trail, open an entry and choose &ldquo;Flag for review&rdquo; to
              park it here until you have looked into it.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-rule rounded-lg border border-rule">
              {flagged.map((entry) => (
                <li key={entry.id} className="px-3 py-2.5">
                  <p className="text-sm">
                    <span className="font-semibold">{entry.performedBy}</span>{' '}
                    <span className="text-muted">
                      {entry.action} {entityLabel(entry.entityType)}
                    </span>
                  </p>
                  {entry.summary && <p className="amount text-xs text-muted">{entry.summary}</p>}
                  {entry.note && <p className="mt-0.5 text-xs italic">&ldquo;{entry.note}&rdquo;</p>}
                  <p className="text-xs text-muted">Flagged {shortDateTime(entry.flaggedAt)}</p>
                  <div className="mt-1.5 flex gap-2">
                    <Link to={`/admin/audit?open=${entry.id}`} className={`${buttonClass} flex items-center`}>
                      Read it
                    </Link>
                    <button type="button" onClick={() => clear(entry)} className={buttonClass}>
                      Clear
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (ip.trim()) navigate(`/admin/audit?ip=${encodeURIComponent(ip.trim())}`);
            }}
          >
            <Field
              label="Everything done from one address"
              htmlFor="audit-ip"
              hint="Each entry remembers the network address it came from. Start from the address on an account's last sign-in."
            >
              <div className="flex gap-2">
                <input
                  id="audit-ip"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="e.g. 41.80.12.7"
                  className={inputClass}
                />
                <button type="submit" disabled={!ip.trim()} className={buttonClass}>
                  Search
                </button>
              </div>
            </Field>
          </form>

          <div>
            <p className="text-sm font-medium">The whole trail, with hashes</p>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              Every entry exactly as stored — snapshots, chain hashes, addresses — as one JSON file. The
              Excel export on the audit screen is the readable version; this is the evidence.
            </p>
            <button type="button" onClick={downloadFull} disabled={busy} className={`${buttonClass} mt-2`}>
              {busy ? 'Preparing…' : 'Download the full audit trail'}
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
