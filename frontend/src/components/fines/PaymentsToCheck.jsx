import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import ConfirmDialog from '../shared/ConfirmDialog';
import { money, shortDate } from '../../utils/format';

// Fine payments recorded before the system asked how they were made.
//
// A payment marked on a fine used to do one thing: lower what the member owed. Whether he had
// handed over cash on the side (so his balance was never involved) or the money was meant to come
// out of his balance, nothing recorded — and nothing can tell the two apart afterwards. So these
// are listed for the office to say, one by one or all at once, and until it does they move nothing
// on the member's side.
//
// Answering "taken from his balance" lowers his balance by that amount, dated the day the payment
// was recorded for, so his statements show it where it happened. Answering "cash" only labels it.
export default function PaymentsToCheck({ onChanged }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [choices, setChoices] = useState({});
  const [failures, setFailures] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/fines/payments/to-check');
      setRows(res.data.payments);
      setLoadError('');
    } catch (err) {
      setLoadError(apiMessage(err, 'Could not load these payments'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const keyOf = (row) => `${row.fineId}:${row.index}`;
  const chosen = useMemo(() => (rows || []).filter((r) => choices[keyOf(r)]), [rows, choices]);
  const fromBalance = chosen.filter((r) => choices[keyOf(r)] === 'balance');
  const balanceTotal = fromBalance.reduce((sum, r) => sum + r.amount, 0);

  function choose(row, source) {
    setChoices((prev) => ({ ...prev, [keyOf(row)]: prev[keyOf(row)] === source ? undefined : source }));
    setFailures((prev) => ({ ...prev, [keyOf(row)]: undefined }));
  }

  function chooseAll(source) {
    const next = {};
    for (const row of rows || []) next[keyOf(row)] = source;
    setChoices(next);
    setFailures({});
  }

  async function save() {
    setBusy(true);
    try {
      const res = await api.post('/api/fines/payments/check', {
        items: chosen.map((r) => ({
          fineId: r.fineId,
          index: r.index,
          amount: r.amount,
          source: choices[keyOf(r)],
        })),
      });
      const failed = {};
      for (const f of res.data.failed || []) failed[`${f.fineId}:${f.index}`] = f.message;
      setFailures(failed);
      const done = res.data.done || 0;
      const stuck = (res.data.failed || []).length;
      toast(
        stuck > 0
          ? `${done} sorted out — ${stuck} could not be done, see below`
          : `${done} ${done === 1 ? 'payment' : 'payments'} sorted out`,
        stuck > 0 ? 'error' : undefined
      );
      setConfirming(false);
      // What was done leaves the list; what could not be done stays, with the reason beside it.
      setChoices((prev) => {
        const keep = {};
        for (const [key, value] of Object.entries(prev)) if (failed[key]) keep[key] = value;
        return keep;
      });
      await load();
      onChanged?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="rounded-xl border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert">
        {loadError}
      </p>
    );
  }
  if (!rows) return <p className="py-8 text-center text-sm text-muted">Loading…</p>;

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
        Nothing to check. Every fine payment on the record says how it was paid.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
        <p className="font-semibold">
          {rows.length} earlier {rows.length === 1 ? 'payment needs' : 'payments need'} you to say how{' '}
          {rows.length === 1 ? 'it was' : 'they were'} paid
        </p>
        <p className="mt-1 text-muted">
          These were recorded before the system asked. It cannot tell whether the member paid in cash on the
          side — his balance is unaffected — or the fine was meant to come out of his balance, which lowers it
          by that amount. Nothing changes on a member’s balance until you choose.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => chooseAll('cash')}
          className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium"
        >
          Mark all as paid in cash
        </button>
        <button
          type="button"
          onClick={() => chooseAll('balance')}
          className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium"
        >
          Mark all as taken from balance
        </button>
        {chosen.length > 0 && (
          <button
            type="button"
            onClick={() => setChoices({})}
            className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted"
          >
            Clear choices
          </button>
        )}
      </div>

      <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
        {rows.map((row) => {
          const key = keyOf(row);
          const picked = choices[key];
          return (
            <li key={key} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {row.memberName}
                    {row.memberRegNumber ? (
                      <span className="font-normal text-muted"> · {row.memberRegNumber}</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {row.type}
                    {row.reason ? ` · ${row.reason}` : ''} · paid {shortDate(row.paidOn)}
                  </p>
                </div>
                <p className="amount shrink-0 text-sm font-semibold">{money(row.amount)}</p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={picked === 'cash'}
                  onClick={() => choose(row, 'cash')}
                  className={`min-h-11 rounded-lg border px-2 text-xs font-semibold ${
                    picked === 'cash' ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
                  }`}
                >
                  Paid in cash / M-Pesa
                </button>
                <button
                  type="button"
                  aria-pressed={picked === 'balance'}
                  onClick={() => choose(row, 'balance')}
                  className={`min-h-11 rounded-lg border px-2 text-xs font-semibold ${
                    picked === 'balance' ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
                  }`}
                >
                  Taken from his balance
                </button>
              </div>
              {failures[key] && (
                <p role="alert" className="mt-2 text-xs text-alert">
                  {failures[key]}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 -mx-1 border-t border-rule bg-canvas/95 px-1 py-3 backdrop-blur">
        <button
          type="button"
          disabled={chosen.length === 0 || busy}
          onClick={() => (fromBalance.length > 0 ? setConfirming(true) : save())}
          className="min-h-12 w-full rounded-xl bg-primary text-sm font-semibold text-white disabled:opacity-50"
        >
          {chosen.length === 0
            ? 'Choose how each was paid'
            : busy
              ? 'Saving…'
              : `Save ${chosen.length} ${chosen.length === 1 ? 'choice' : 'choices'}`}
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Take these from members’ balances?"
        body={`${fromBalance.length} ${
          fromBalance.length === 1 ? 'payment' : 'payments'
        }, ${money(balanceTotal)} in all, will come off what the group holds for those members, dated the day each was paid. A member who does not hold enough is skipped and listed here with the reason.`}
        confirmLabel="Take from balances"
        busy={busy}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
