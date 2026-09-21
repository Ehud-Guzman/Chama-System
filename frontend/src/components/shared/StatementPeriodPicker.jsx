import { useState } from 'react';
import { STATEMENT_PERIODS, periodQuery, periodLabel } from '../../utils/statementPeriod';

// Choosing the period a statement covers.
//
// One component, used by the office's member page and by the members' own passbook, plus the hook
// that turns the choice into a query string. It is shared for the same reason the statement itself
// is: two pickers would eventually offer two different sets of periods, and "why can he download
// 2026 and I can't" is the kind of question that costs an afternoon.
//
// The default is deliberately the **whole book** — the statement exactly as it has always been. A
// period is something a person asks for, not something they get by accident.
const PRESETS = STATEMENT_PERIODS;

// `from`/`to` are only used by the custom option; the named ranges resolve on the server.
export function useStatementPeriod() {
  const [preset, setPreset] = useState('whole');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  return {
    preset,
    from,
    to,
    setPreset,
    setFrom,
    setTo,
    query: periodQuery(preset, from, to),
    label: periodLabel(preset),
    // Whether anything other than the whole book is selected — for a message that says so.
    isWholeBook: preset === 'whole',
  };
}

export default function StatementPeriodPicker({
  preset,
  from,
  to,
  onChange,
  className = '',
  idPrefix = 'period',
}) {
  const custom = preset === 'custom';
  const invalidRange = custom && from && to && to < from;

  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <label htmlFor={`${idPrefix}-preset`} className="mb-1 block text-xs font-medium text-muted">
        Statement period
      </label>
      <select
        id={`${idPrefix}-preset`}
        value={preset}
        onChange={(e) => onChange({ preset: e.target.value })}
        className="h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm"
      >
        {PRESETS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {custom && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}-from`} className="mb-1 block text-xs text-muted">
              From
            </label>
            <input
              id={`${idPrefix}-from`}
              type="date"
              value={from}
              onChange={(e) => onChange({ from: e.target.value })}
              className="h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-to`} className="mb-1 block text-xs text-muted">
              To <span className="font-normal">(optional — today if left blank)</span>
            </label>
            <input
              id={`${idPrefix}-to`}
              type="date"
              value={to}
              onChange={(e) => onChange({ to: e.target.value })}
              className="h-11 w-full rounded-xl border border-rule bg-surface px-3 text-sm"
            />
          </div>
          {invalidRange && (
            // Caught here rather than on the server so the office is told before a download that
            // would come back as a 400.
            <p className="text-xs font-medium text-alert sm:col-span-2" role="alert">
              The end date is before the start date.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
