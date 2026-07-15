import { useState } from 'react';
import { useModal } from '../../hooks/useModal';
import { todayISO } from '../../utils/format';

function toDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

// Create/edit member form, rendered inside a modal sheet.
export default function MemberForm({ initial, busy, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    regNumber: initial?.regNumber || '',
    notes: initial?.notes || '',
    joinDate: toDateInput(initial?.joinDate),
  });
  const containerRef = useModal(true, onCancel);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={initial ? 'Edit member' : 'Add member'}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <form
        ref={containerRef}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
        className="max-h-[85dvh] w-full max-w-sm space-y-3 overflow-y-auto rounded-xl bg-surface p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">{initial ? 'Edit member' : 'Add member'}</h2>
        <div>
          <label htmlFor="m-name" className="mb-1 block text-sm font-medium">
            Name
          </label>
          <input
            id="m-name"
            type="text"
            required
            value={form.name}
            onChange={set('name')}
            className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
        </div>
        <div>
          <label htmlFor="m-phone" className="mb-1 block text-sm font-medium">
            Phone
          </label>
          <input
            id="m-phone"
            type="tel"
            inputMode="tel"
            required
            placeholder="07XX XXX XXX"
            value={form.phone}
            onChange={set('phone')}
            className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
        </div>
        <div>
          <label htmlFor="m-email" className="mb-1 block text-sm font-medium">
            Email <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="m-email"
            type="email"
            value={form.email}
            onChange={set('email')}
            className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
        </div>
        <div>
          <label htmlFor="m-reg" className="mb-1 block text-sm font-medium">
            Reg number <span className="font-normal text-muted">(optional, auto-assigned)</span>
          </label>
          <input
            id="m-reg"
            type="text"
            value={form.regNumber}
            onChange={set('regNumber')}
            className="amount h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
        </div>
        <div>
          <label htmlFor="m-join-date" className="mb-1 block text-sm font-medium">
            Join date <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="m-join-date"
            type="date"
            max={todayISO()}
            value={form.joinDate}
            onChange={set('joinDate')}
            className="h-12 w-full rounded-xl border border-rule px-3 text-sm"
          />
          <p className="mt-1 text-xs text-muted">
            Anchors their weekly contribution schedule — week 1 starts here.
          </p>
        </div>
        <div>
          <label htmlFor="m-notes" className="mb-1 block text-sm font-medium">
            Notes <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="m-notes"
            rows={2}
            value={form.notes}
            onChange={set('notes')}
            className="w-full rounded-xl border border-rule px-4 py-3 text-sm"
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
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Add member'}
          </button>
        </div>
      </form>
    </div>
  );
}
