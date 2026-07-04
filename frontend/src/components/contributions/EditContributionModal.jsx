import { useEffect, useState } from 'react';
import api from '../../services/api';
import { todayISO, METHOD_LABELS } from '../../utils/format';

const METHODS = Object.keys(METHOD_LABELS);

export default function EditContributionModal({ contribution, busy, onSubmit, onCancel }) {
  const currentTypeId = contribution.typeId?._id || contribution.typeId || '';
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({
    typeId: currentTypeId,
    amount: String(contribution.amount),
    date: new Date(contribution.date).toISOString().slice(0, 10),
    method: contribution.method,
    note: contribution.note || '',
  });

  // Active types plus the contribution's current type, even if it's since been deactivated
  useEffect(() => {
    api
      .get('/api/types')
      .then((res) => {
        let list = res.data.types;
        if (currentTypeId && !list.some((t) => t._id === currentTypeId)) {
          list = [
            ...list,
            { _id: currentTypeId, name: contribution.typeId?.name || 'Unknown type' },
          ];
        }
        setTypes(list);
      })
      .catch(() => {});
  }, [currentTypeId, contribution.typeId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Edit contribution"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
        className="w-full max-w-sm space-y-3 rounded-xl bg-surface p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">Edit contribution</h2>
        <div>
          <label htmlFor="ec-amount" className="mb-1 block text-sm font-medium">
            Amount (Ksh)
          </label>
          <input
            id="ec-amount"
            type="text"
            inputMode="numeric"
            required
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="amount h-12 w-full rounded-xl border border-rule px-4"
          />
        </div>
        <div>
          <label htmlFor="ec-date" className="mb-1 block text-sm font-medium">
            Date
          </label>
          <input
            id="ec-date"
            type="date"
            required
            max={todayISO()}
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Contribution type</legend>
          <div className="flex flex-wrap gap-2">
            {types.map((t) => (
              <button
                key={t._id}
                type="button"
                onClick={() => setForm({ ...form, typeId: t._id })}
                aria-pressed={form.typeId === t._id}
                className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${
                  form.typeId === t._id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-rule text-muted'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Method</legend>
          <div className="grid grid-cols-4 gap-2">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setForm({ ...form, method: m })}
                aria-pressed={form.method === m}
                className={`min-h-11 rounded-lg border text-xs font-semibold ${
                  form.method === m
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-rule text-muted'
                }`}
              >
                {METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="ec-note" className="mb-1 block text-sm font-medium">
            Note <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="ec-note"
            type="text"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
        </div>
        <div className="flex gap-3 pt-1">
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
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
