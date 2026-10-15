import { useMemo, useState } from 'react';
import api from '../../services/api';
import { blobErrorMessage } from '../../utils/blobError';
import { useToast } from '../shared/Toast';
import { EXPENSE_PERIODS, printQuery, sectionsFor } from '../../utils/printReport';

// Pick what the meeting needs on paper, and get it as one PDF with each part's totals.
//
// Every figure on this page already exists behind one of the other tabs; this is the one place that
// puts them together. The sections are ticked rather than fixed because a meeting that is only
// chasing debts does not want the spending, and the treasurer's copy wants all of it. The PDF is
// built by the server from the same figures the tabs read, so the page in somebody's hand and the
// screen cannot disagree.
export default function PrintReportPanel({ role, weekNumber }) {
  const toast = useToast();
  const options = useMemo(() => sectionsFor(role), [role]);
  // Everything ticked to begin with: the full page is the common case, and unticking is quicker
  // than ticking six boxes on a phone.
  const [selected, setSelected] = useState(() => new Set(options.map((s) => s.key)));
  const [period, setPeriod] = useState('week');
  const [busy, setBusy] = useState(false);

  const params = printQuery(selected, period, role);
  const wantsSpending = selected.has('expenses') && options.some((s) => s.key === 'expenses');

  function toggle(key) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Fetched as a blob rather than linked: a bare link that meets an error shows raw JSON in the
  // browser instead of the app's own message.
  async function download() {
    if (!params) return;
    setBusy(true);
    try {
      const res = await api.get('/api/reports/print', { params, responseType: 'blob' });
      const objectUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = weekNumber ? `meeting-report-week-${weekNumber}.pdf` : 'meeting-report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      toast(await blobErrorMessage(err, 'Could not build the report'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <p className="text-sm text-muted">
        Tick what the meeting needs. Each part is closed by its total, and the page is built from
        the same figures as the other tabs, as they stand now
        {weekNumber ? ` (week ${weekNumber})` : ''}.
      </p>

      <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
        {options.map((section) => (
          <li key={section.key}>
            {/* The whole row is the target: a 16px box is not something to hit on a phone. */}
            <label className="flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={selected.has(section.key)}
                onChange={() => toggle(section.key)}
                className="mt-1 h-5 w-5 shrink-0"
              />
              <span>
                <span className="block text-sm font-medium">{section.label}</span>
                <span className="block text-xs text-muted">{section.hint}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {wantsSpending && (
        <div className="rounded-xl border border-rule bg-surface px-4 py-3">
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted" htmlFor="print-expense-period">
            Spending to list
          </label>
          <select
            id="print-expense-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
          >
            {EXPENSE_PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={download}
          disabled={!params || busy}
          className="min-h-12 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Building…' : 'Download PDF'}
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set(options.map((s) => s.key)))}
          className="min-h-11 px-2 text-sm font-medium text-primary"
        >
          Tick all
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          className="min-h-11 px-2 text-sm font-medium text-muted"
        >
          Clear
        </button>
        {!params && <span className="text-xs text-muted">Tick at least one part to print.</span>}
      </div>

      <p className="text-[11px] leading-5 text-muted">
        &ldquo;The line&rdquo; is the group&rsquo;s money line (Settings &rarr; Reminders): what a member
        is expected to hold with the group by this week. Below it is a debt, at or above it is extra.
        The PDF opens in your downloads, ready to print.
      </p>
    </section>
  );
}
