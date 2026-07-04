import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { todayISO } from '../../utils/format';

// Issues a fine against a member already in view on MemberDetail — the
// member is fixed, so this is just type + amount + reason + date.
export default function IssueFineForm({ memberId, onIssued, onCancel }) {
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [typeId, setTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get('/api/fine-types')
      .then((res) => {
        setTypes(res.data.types);
        if (res.data.types.length > 0) setTypeId((prev) => prev || res.data.types[0]._id);
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    const value = Number(String(amount).replace(/[,\s]/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      toast('Enter an amount greater than zero', 'error');
      return;
    }
    if (!typeId) {
      toast('Select a fine type', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/fines', { memberId, typeId, amount: value, reason: reason.trim(), date });
      toast('Fine issued');
      onIssued?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-rule bg-surface p-4 space-y-3">
      <p className="text-sm font-semibold">Issue a fine</p>

      {types.length === 0 ? (
        <p className="text-xs text-muted">No fine types yet — add one from the Dashboard first.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {types.map((t) => (
            <button
              key={t._id}
              type="button"
              onClick={() => setTypeId(t._id)}
              aria-pressed={typeId === t._id}
              className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${
                typeId === t._id ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        inputMode="numeric"
        required
        placeholder="Amount (Ksh)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
        aria-label="Fine amount"
      />
      <input
        type="text"
        placeholder="Reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
        aria-label="Fine reason"
      />
      <input
        type="date"
        max={todayISO()}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="h-12 w-full rounded-xl border border-rule px-3 text-sm"
      />

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 flex-1 rounded-xl border border-rule text-sm font-medium"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 flex-1 rounded-xl bg-primary text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Issuing…' : 'Issue fine'}
        </button>
      </div>
    </form>
  );
}
