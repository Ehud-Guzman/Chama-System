import { useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { money } from '../../utils/format';

// Per-type pledge amounts for one member, editable inline. Contributed is
// read-only (it comes from logged contributions); pledged is what the admin sets.
export default function PledgeEditor({ memberId, byType, onSaved }) {
  const toast = useToast();
  const [editingId, setEditingId] = useState(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  function startEdit(entry) {
    setEditingId(entry.typeId);
    setValue(entry.pledged > 0 ? String(entry.pledged) : '');
  }

  async function save(typeId) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      toast('Enter a pledge amount of zero or more', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.put(`/api/members/${memberId}/pledges/${typeId}`, { amount: n });
      toast('Pledge updated');
      setEditingId(null);
      onSaved();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (byType.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-rule px-5 py-6 text-center text-sm text-muted">
        No contribution types set up yet.
      </p>
    );
  }

  return (
    <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
      {byType.map((entry) => (
        <li key={entry.typeId} className="border-b border-rule px-4 py-3 last:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">{entry.name}</p>
            {editingId !== entry.typeId && (
              <button
                type="button"
                onClick={() => startEdit(entry)}
                className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-medium text-primary"
              >
                {entry.pledged > 0 ? 'Edit pledge' : 'Set pledge'}
              </button>
            )}
          </div>
          {editingId === entry.typeId ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                className="amount h-11 w-full rounded-lg border border-rule px-3 text-sm"
                aria-label={`Pledge amount for ${entry.name}`}
              />
              <button
                type="button"
                onClick={() => save(entry.typeId)}
                disabled={busy}
                className="min-h-11 shrink-0 rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="min-h-11 shrink-0 rounded-lg border border-rule px-3 text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          ) : (
            <p className="amount mt-0.5 text-sm text-muted">
              {money(entry.contributed)} of{' '}
              {entry.pledged > 0 ? `${money(entry.pledged)} pledged` : 'no pledge set'}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
