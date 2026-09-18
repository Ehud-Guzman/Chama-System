import { useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { money, todayISO } from '../../utils/format';

// Records a fine being paid outside the weekly ledger — cash handed to the
// treasurer, or an M-Pesa payment that was never logged as a contribution.
//
// Without this the only way to clear a fine was to void it, which is a lie about
// what happened to the money: voiding says the fine should never have been issued.
// The amount is prefilled with the whole outstanding figure because paying in full
// is the usual case; a smaller figure is a part payment and the balance stays on
// the fine.
export default function SettleFineForm({ fine, onSettled, onCancel }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(fine.remaining ?? ''));
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const value = Number(String(amount).replace(/[,\s]/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      toast('Enter an amount greater than zero', 'error');
      return;
    }
    if (value > fine.remaining) {
      toast(`That is more than the ${money(fine.remaining)} outstanding`, 'error');
      return;
    }

    setBusy(true);
    try {
      const res = await api.post(`/api/fines/${fine._id}/settle`, { amount: value, date });
      const left = res.data?.fine?.remaining ?? 0;
      toast(
        left > 0
          ? `${money(value)} recorded — ${money(left)} still outstanding`
          : 'Fine settled in full'
      );
      onSettled?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-rule bg-surface p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">Record a fine payment</p>
        <p className="amount text-sm font-semibold text-alert">{money(fine.remaining)} outstanding</p>
      </div>
      <p className="text-xs text-muted">
        {fine.typeId?.name || fine.type}
        {fine.reason ? ` · ${fine.reason}` : ''}
      </p>

      <input
        type="text"
        inputMode="numeric"
        required
        placeholder="Amount paid (Ksh)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
        aria-label="Amount paid"
      />
      <input
        type="date"
        max={todayISO()}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="h-12 w-full rounded-xl border border-rule px-3 text-sm"
        aria-label="Date paid"
      />
      <p className="text-xs text-muted">
        The date the money was handed over — a payment recorded days later still belongs to
        the meeting it was made at.
      </p>

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
          {busy ? 'Recording…' : 'Record payment'}
        </button>
      </div>
    </form>
  );
}
