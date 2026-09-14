import { useEffect, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { money } from '../../utils/format';

const EMPTY_FORM = {
  name: '',
  description: '',
  isWeekly: false,
  weeklyAmount: '',
  tracksExpenses: false,
  isGroupFund: false,
  isRecoverable: false,
};

function Badge({ children, tone = 'muted' }) {
  const colors = {
    primary: 'bg-primary/10 text-primary',
    accent: 'bg-accent/10 text-accent',
    alert: 'bg-alert/10 text-alert',
    muted: 'bg-canvas text-muted',
  };
  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${colors[tone]}`}>
      {children}
    </span>
  );
}

function ToggleRow({ label, description, checked, onChange, disabled }) {
  return (
    <label className={`flex gap-3 rounded-lg border border-rule p-3 ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-1"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted">{description}</span>
      </span>
    </label>
  );
}

export default function TypeManager({ onChange }) {
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [editingWeeklyId, setEditingWeeklyId] = useState(null);
  const [weeklyValue, setWeeklyValue] = useState('');

  async function load() {
    try {
      const res = await api.get('/api/types', { params: { all: true } });
      setTypes(res.data.types);
    } catch {
      // Non-fatal; the list simply stays empty
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/types', {
        ...form,
        weeklyAmount: form.isWeekly ? Number(form.weeklyAmount) || 0 : 0,
        isRecoverable: form.tracksExpenses && form.isRecoverable,
      });
      toast('Contribution type added');
      setForm(EMPTY_FORM);
      load();
      onChange?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(type) {
    try {
      await api.patch(`/api/types/${type._id}`, { active: !type.active });
      toast(type.active ? 'Type deactivated' : 'Type reactivated');
      load();
      onChange?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    }
  }

    async function toggleGroupFund(type) {
    try {
      await api.patch(`/api/types/${type._id}`, { isGroupFund: !type.isGroupFund });
      toast(
        type.isGroupFund
          ? 'Now counts toward members’ personal totals'
          : 'Now excluded from members’ personal totals'
      );
      load();
      onChange?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    }
  }


  async function toggleRecoverable(type) {
    try {
      await api.patch(`/api/types/${type._id}`, { isRecoverable: !type.isRecoverable });
      toast(
        type.isRecoverable
          ? 'Now counted as a real expense'
          : 'Now excluded from expenses as a recoverable loan'
      );
      load();
      onChange?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    }
  }

  async function saveWeeklyAmount(type) {
    const n = Number(weeklyValue);
    if (!Number.isFinite(n) || n < 0) {
      toast('Enter a weekly amount of zero or more', 'error');
      return;
    }
    try {
      await api.patch(`/api/types/${type._id}`, { weeklyAmount: n });
      setEditingWeeklyId(null);
      load();
      onChange?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    }
  }

  const activeCount = types.filter((t) => t.active).length;
  const weeklyCount = types.filter((t) => t.isWeekly).length;
  const fundCount = types.filter((t) => t.tracksExpenses).length;

  return (
    <section className="flex max-h-[500px] flex-col overflow-hidden rounded-xl border border-rule bg-surface lg:max-h-[600px]">
      {/* Header */}
      <div className="border-b border-rule p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Contribution types</h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              Define what members pay into, what repeats weekly, and what belongs to the group.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="primary">{activeCount} active</Badge>
            <Badge>{weeklyCount} weekly</Badge>
            <Badge tone="accent">{fundCount} funds</Badge>
          </div>
        </div>
      </div>

      {/* Content grid */}
      <div className="flex flex-1 flex-col gap-0 overflow-hidden xl:flex-row">
        {/* Types list */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {types.length === 0 ? (
            <p className="p-5 text-sm text-muted">No contribution types yet.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {types.map((t) => (
                <li key={t._id} className={`p-4 ${t.active ? '' : 'bg-canvas/60'}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{t.name}</p>
                      {t.description && (
                        <p className="mt-0.5 truncate text-xs text-muted">{t.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {!t.active && <Badge>Inactive</Badge>}
                        {t.isWeekly && <Badge tone="primary">Weekly</Badge>}
                        {t.tracksExpenses && <Badge tone="accent">Tracks expenses</Badge>}
                        {t.isGroupFund && <Badge tone="alert">Group fund</Badge>}
                        {t.isRecoverable && <Badge>Recoverable</Badge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => toggleGroupFund(t)}
                        className="min-h-10 flex-1 rounded-lg border border-rule px-3 text-xs font-medium sm:flex-none"
                      >
                        {t.isGroupFund ? 'Personal total' : 'Group fund'}
                      </button>
                      {t.tracksExpenses && (
                        <button
                          type="button"
                          onClick={() => toggleRecoverable(t)}
                          className="min-h-10 flex-1 rounded-lg border border-rule px-3 text-xs font-medium sm:flex-none"
                        >
                          {t.isRecoverable ? 'Real expense' : 'Recoverable'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleActive(t)}
                        className="min-h-10 flex-1 rounded-lg border border-rule px-3 text-xs font-medium sm:flex-none"
                      >
                        {t.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </div>

                  {t.isWeekly && (
                    <div className="mt-2">
                      {editingWeeklyId === t._id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            autoFocus
                            value={weeklyValue}
                            onChange={(e) => setWeeklyValue(e.target.value)}
                            className="amount h-10 w-32 rounded-lg border border-rule bg-canvas px-3 text-sm"
                            aria-label={`Weekly amount for ${t.name}`}
                          />
                          <button
                            type="button"
                            onClick={() => saveWeeklyAmount(t)}
                            className="min-h-10 rounded-lg bg-primary px-3 text-xs font-semibold text-white"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingWeeklyId(null)}
                            className="min-h-10 rounded-lg border border-rule px-3 text-xs font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingWeeklyId(t._id);
                            setWeeklyValue(String(t.weeklyAmount || ''));
                          }}
                          className="amount rounded-lg bg-primary/10 px-2 py-1 text-xs font-semibold text-primary"
                        >
                          {money(t.weeklyAmount)} / week - edit
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Form */}
        <form
          onSubmit={onSubmit}
          className="space-y-3 border-t border-rule bg-canvas p-4 xl:w-80 xl:border-l xl:border-t-0 xl:overflow-y-auto"
        >
          <div>
            <p className="text-sm font-bold">Add type</p>
            <p className="mt-1 text-xs text-muted">Set the rules once, then the logs and reports follow them.</p>
          </div>
          <input
            type="text"
            required
            placeholder="Name, e.g. Development Fund"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="h-11 w-full rounded-lg border border-rule bg-surface px-3 text-sm"
            aria-label="Type name"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="h-11 w-full rounded-lg border border-rule bg-surface px-3 text-sm"
            aria-label="Type description"
          />
          <ToggleRow
            label="Fixed weekly due"
            description="Use for recurring amounts like weekly contribution or chai."
            checked={form.isWeekly}
            onChange={(checked) => setForm({ ...form, isWeekly: checked })}
          />
          {form.isWeekly && (
            <input
              type="text"
              inputMode="numeric"
              placeholder="Amount due per week, e.g. 1400"
              value={form.weeklyAmount}
              onChange={(e) => setForm({ ...form, weeklyAmount: e.target.value })}
              className="amount h-11 w-full rounded-lg border border-rule bg-surface px-3 text-sm"
              aria-label="Weekly amount"
            />
          )}
          <ToggleRow
            label="Tracks expenses"
            description="Use when money collected under this type can be spent from the fund."
            checked={form.tracksExpenses}
            onChange={(checked) =>
              setForm({ ...form, tracksExpenses: checked, isRecoverable: checked ? form.isRecoverable : false })
            }
          />
          <ToggleRow
            label="Recoverable"
            description="Use for loans or advances that should not count as real expenses."
            checked={form.isRecoverable}
            disabled={!form.tracksExpenses}
            onChange={(checked) => setForm({ ...form, isRecoverable: checked })}
          />
          <ToggleRow
            label="Group fund"
            description="Exclude this type from members' personal contribution totals."
            checked={form.isGroupFund}
            onChange={(checked) => setForm({ ...form, isGroupFund: checked })}
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-12 w-full rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Adding…' : 'Add type'}
          </button>
        </form>
      </div>
    </section>
  );
}