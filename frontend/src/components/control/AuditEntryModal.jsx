import { useCallback, useEffect, useRef, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useModal } from '../../hooks/useModal';
import { useToast } from '../shared/Toast';
import Modal from '../shared/Modal';
import Loader from '../shared/Loader';
import { shortDateTime } from '../../utils/format';
import { changedFields, showValue } from '../../utils/auditDiff';
import { Pill, buttonClass, primaryButtonClass, inputClass } from './controlUi';

// One audit entry, exactly as stored — the super admin's view.
//
// The audit screen is for scanning; this is for evidence. It shows the whole before and after (which
// the screen never sends), the fields that actually differ, the chain hash that ties the entry to
// the one before it, the network address it came from, and the notes made about it. From here an
// entry can be flagged for a second look, or cleared once it has had one.

const ACTION_PAST = { create: 'created', update: 'edited', delete: 'deleted', reset: 'reset' };

function Json({ value }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg border border-rule bg-canvas p-3 text-xs leading-5">
      {value === null || value === undefined ? 'nothing (this entry has no such side)' : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function AuditEntryModal({ id, onClose, onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(null);
  const containerRef = useModal(Boolean(id), onClose, closeRef);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/superadmin/audit/${id}`);
      setData(res.data);
      setError('');
    } catch (err) {
      setError(apiMessage(err, 'Could not read that entry'));
    }
  }, [id]);

  useEffect(() => {
    setData(null);
    setNote('');
    if (id) load();
  }, [id, load]);

  async function review(status) {
    setBusy(true);
    try {
      await api.post(`/api/superadmin/audit/${id}/review`, { status, note });
      toast(status === 'flagged' ? 'Flagged for review' : 'Cleared');
      setNote('');
      await load();
      onChanged?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!id) return null;

  const entry = data?.entry;
  const reviews = data?.reviews || [];
  const flagged = reviews[0]?.status === 'flagged';
  const diff = entry ? changedFields(entry.before, entry.after) : [];

  return (
    <Modal
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-3 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Audit entry"
      onBackdropClick={onClose}
    >
      <div
        ref={containerRef}
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-xl bg-surface shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Audit entry, as stored</p>
            <h2 className="mt-0.5 text-base font-semibold">
              {entry
                ? `${entry.performedBy?.name || 'Unknown'} ${ACTION_PAST[entry.action] || entry.action} ${String(
                    entry.entityType
                  )
                    .replace(/([a-z])([A-Z])/g, '$1 $2')
                    .toLowerCase()}`
                : 'Reading…'}
            </h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className={buttonClass}>
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && !data && (
            <p role="alert" className="text-sm text-alert">
              {error}
            </p>
          )}
          {!data && !error && <Loader />}

          {entry && (
            <>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">When</dt>
                  <dd>{shortDateTime(entry.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Who</dt>
                  <dd>
                    {entry.performedBy
                      ? `${entry.performedBy.name} (${entry.performedBy.email}, ${entry.performedBy.role})`
                      : 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">From address</dt>
                  <dd className="amount">{entry.ip || 'not recorded (made by a job, a script, or before addresses were kept)'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Record</dt>
                  <dd className="amount break-all">
                    {entry.entityType} · {entry.entityId}
                  </dd>
                </div>
                {entry.summary && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted">What the screen says</dt>
                    <dd>{entry.summary}</dd>
                  </div>
                )}
              </dl>

              {entry.flags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {entry.flags.map((flag) => (
                    <Pill key={flag.key} tone={flag.severity === 'high' ? 'bad' : 'warn'}>
                      {flag.label}
                    </Pill>
                  ))}
                </div>
              )}

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">What changed</h3>
                {diff.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">No field differs between the two sides.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-rule rounded-lg border border-rule">
                    {diff.map((row) => (
                      <li key={row.field} className="grid gap-x-3 px-3 py-2 text-sm sm:grid-cols-[10rem_1fr]">
                        <span className="font-medium">{row.field}</span>
                        <span className="min-w-0 break-words">
                          <span className={row.from === undefined || row.from === null ? 'text-muted' : 'text-muted line-through'}>
                            {showValue(row.from)}
                          </span>
                          {' → '}
                          <span className="font-medium">{showValue(row.to)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <details>
                <summary className="cursor-pointer py-2 text-sm font-medium text-primary">
                  The whole record, before and after
                </summary>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold text-muted">Before</p>
                    <Json value={entry.before} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-muted">After</p>
                    <Json value={entry.after} />
                  </div>
                </div>
              </details>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">Place in the chain</h3>
                {entry.chain.hash ? (
                  <dl className="mt-1 space-y-1 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-muted">Entry number</dt>
                      <dd className="amount">{entry.chain.sequence}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-muted">Its hash</dt>
                      <dd className="amount break-all">{entry.chain.hash}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-muted">Points back at</dt>
                      <dd className="amount break-all">{entry.chain.prevHash}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-1 text-sm text-muted">
                    This entry was written before the chain existed, so it carries no hash.
                  </p>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">Review</h3>
                {reviews.length > 0 && (
                  <ul className="mt-2 divide-y divide-rule rounded-lg border border-rule">
                    {reviews.map((item) => (
                      <li key={item.id} className="px-3 py-2 text-sm">
                        <Pill tone={item.status === 'flagged' ? 'warn' : 'good'}>
                          {item.status === 'flagged' ? 'Flagged' : 'Cleared'}
                        </Pill>{' '}
                        <span className="text-muted">
                          by {item.by}, {shortDateTime(item.at)}
                        </span>
                        {item.note && <p className="mt-0.5">&ldquo;{item.note}&rdquo;</p>}
                      </li>
                    ))}
                  </ul>
                )}
                <label htmlFor="review-note" className="mt-3 block text-xs font-medium">
                  Note (optional)
                </label>
                <input
                  id="review-note"
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Ask the treasurer what this was for"
                  className={inputClass}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {flagged ? (
                    <button type="button" disabled={busy} onClick={() => review('cleared')} className={primaryButtonClass}>
                      Clear it
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => review('flagged')} className={primaryButtonClass}>
                      Flag for review
                    </button>
                  )}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted">
                  Reviews are your own notes, kept apart from the trail so that writing one never touches
                  the chain.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
