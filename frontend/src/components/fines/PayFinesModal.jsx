import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import Modal from '../shared/Modal';
import { useModal } from '../../hooks/useModal';
import { money, shortDate, todayISO } from '../../utils/format';
import {
  balanceChoice,
  owedFor,
  parseAmount,
  paymentPreview,
  paymentSummary,
} from '../../utils/finePayment';
import { searchOwed } from '../../utils/finesOwed';

// Recording a fine payment, start to finish, in one place.
//
// The old screen put a form at the top of a long page, however far down the Pay button was, and it
// never asked how the money had arrived — so a fine marked paid did nothing to the member's money.
// This one opens over whatever the office is looking at and walks the way a meeting does:
//
//   1. who is paying (skipped when it was opened from a member or a fine),
//   2. which fine — one at a time, because each payment is for a single fine,
//   3. how much,
//   4. how it was paid: taken out of his balance, or handed over separately. This is the one
//      question that decides whether his balance moves, so it is asked in plain words, with what
//      each answer will do to his figures beside it, and there is no default to slide past.
//
// Nothing is recorded until the summary line under the buttons reads right, and when it is recorded
// the dialog says what happened in a sentence the office can read out.
export default function PayFinesModal({
  memberId: initialMemberId = null,
  fineId: initialFineId = null,
  owingMembers = [],
  onClose,
  onPaid,
}) {
  const toast = useToast();
  // The parent hands in a fresh function on every render; the dialog's focus handling re-runs
  // whenever its close handler changes, which would pull focus out of the field being typed in the
  // moment the page behind refreshed. So it is given one that never changes.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => closeRef.current?.(), []);
  const containerRef = useModal(true, close);
  const amountRef = useRef(null);

  const [memberId, setMemberId] = useState(initialMemberId);
  const [term, setTerm] = useState('');
  const [position, setPosition] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [fineId, setFineId] = useState(initialFineId);
  const [amountText, setAmountText] = useState('');
  const [source, setSource] = useState(null);
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  // The member's position: what he owes, fine by fine, and what the group holds for him.
  useEffect(() => {
    if (!memberId) return undefined;
    let cancelled = false;
    setPosition(null);
    setLoadError('');
    api
      .get(`/api/fines/member/${memberId}/position`)
      .then((res) => {
        if (cancelled) return;
        setPosition(res.data);
        // The fine he was opened on, or the only one there is; otherwise the office chooses.
        const stillOwed = res.data.fines.some((f) => String(f.id) === String(initialFineId));
        setFineId(
          stillOwed ? initialFineId : res.data.fines.length === 1 ? res.data.fines[0].id : null
        );
      })
      .catch((err) => {
        if (!cancelled) setLoadError(apiMessage(err, 'Could not load this member'));
      });
    return () => {
      cancelled = true;
    };
  }, [memberId, initialFineId]);

  const fines = position?.fines || [];
  const owed = useMemo(() => owedFor(fines, fineId), [fines, fineId]);
  const held = position?.held || 0;

  // The amount follows what is being paid: all of it by default, because paying in full is the
  // usual case, and a part payment is one edit away.
  useEffect(() => {
    if (position) setAmountText(owed > 0 ? String(owed) : '');
    // `owed` is 0 until a fine is chosen, which clears the field.
  }, [position, owed]);

  const amount = parseAmount(amountText);
  const preview = fineId
    ? paymentPreview({ owed, held, amount, source })
    : { valid: false, problem: 'Choose which fine is being paid', owedAfter: owed, heldAfter: null };
  const balance = balanceChoice({ held, amount: Number.isFinite(amount) ? amount : 0 });
  const candidates = useMemo(() => searchOwed(owingMembers, term, 'name').slice(0, 40), [owingMembers, term]);

  async function submit(e) {
    e.preventDefault();
    if (!preview.valid || busy) return;
    setBusy(true);
    try {
      const res = await api.post(`/api/fines/member/${memberId}/pay`, {
        amount,
        source,
        date,
        fineId,
      });
      const owedAfter = Math.max(0, Math.round((position.owed - res.data.totalApplied) * 100) / 100);
      setResult({ ...res.data, owedAfter });
      onPaid?.(res.data);
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record a fine payment"
      onBackdropClick={close}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              {result ? 'Payment recorded' : 'Record a fine payment'}
            </h2>
            {position && !result && (
              <p className="mt-0.5 truncate text-sm text-muted">
                {position.member.name}
                {position.member.regNumber ? ` · ${position.member.regNumber}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-mr-2 -mt-1 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xl text-muted hover:bg-canvas"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* ------------------------------------------------ 1. who is paying */}
          {!memberId && (
            <div className="space-y-3">
              <p className="text-sm text-muted">Who is paying? Only members who owe a fine are listed.</p>
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search name, phone or reg number"
                aria-label="Search members who owe fines"
                className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
                autoFocus
              />
              {owingMembers.length === 0 ? (
                <p className="rounded-xl border border-dashed border-rule px-5 py-6 text-center text-sm text-muted">
                  Nobody owes a fine, so there is nothing to pay.
                </p>
              ) : candidates.length === 0 ? (
                <p className="rounded-xl border border-dashed border-rule px-5 py-6 text-center text-sm text-muted">
                  Nobody matches “{term.trim()}”.
                </p>
              ) : (
                <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule">
                  {candidates.map((m) => (
                    <li key={m.memberId}>
                      <button
                        type="button"
                        onClick={() => setMemberId(m.memberId)}
                        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left hover:bg-canvas"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{m.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {[m.regNumber, m.phone].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className="amount shrink-0 text-sm font-semibold text-alert">
                          {money(m.outstanding)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {memberId && !position && !loadError && <p className="py-8 text-center text-sm text-muted">Loading…</p>}
          {loadError && (
            <p role="alert" className="rounded-xl border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert">
              {loadError}
            </p>
          )}

          {/* ------------------------------------------------ the finished payment */}
          {result && position && (
            <div className="space-y-4">
              <p className="rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary">
                {paymentSummary({
                  memberName: position.member.name,
                  totalApplied: result.totalApplied,
                  source: result.source,
                  held: result.held,
                  owedAfter: result.owedAfter,
                })}
              </p>
              <ul className="divide-y divide-rule rounded-xl border border-rule">
                {result.fines.map((f) => (
                  <li key={f.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 truncate">{f.reason || f.type || 'Fine'}</span>
                    <span className="amount shrink-0 text-xs text-muted">
                      {f.remaining > 0 ? `${money(f.remaining)} still owed` : 'cleared'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                The member is emailed an acknowledgement if he has an address on file. A payment keyed in by
                mistake can be taken back from the fine’s history.
              </p>
            </div>
          )}

          {/* ------------------------------------------------ 2-4. the payment */}
          {position && !result && (
            <form id="pay-fines-form" onSubmit={submit} className="space-y-5">
              {fines.length === 0 ? (
                <p className="rounded-xl border border-dashed border-rule px-5 py-6 text-center text-sm text-muted">
                  {position.member.name} owes no fine.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-rule bg-canvas px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Owes in fines</p>
                      <p className="amount mt-0.5 text-lg font-bold text-alert">{money(position.owed)}</p>
                    </div>
                    <div className="rounded-xl border border-rule bg-canvas px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Group holds for him</p>
                      <p className="amount mt-0.5 text-lg font-bold">{money(held)}</p>
                    </div>
                  </div>

                  {/* Which fine: one at a time, each payment is for a single fine. */}
                  {fines.length > 1 ? (
                    <fieldset>
                      <legend className="mb-2 text-sm font-semibold">Which fine is he paying?</legend>
                      <div role="radiogroup" aria-label="Which fine" className="space-y-2">
                        {fines.map((f) => (
                          <Choice
                            key={f.id}
                            checked={String(fineId) === String(f.id)}
                            onSelect={() => setFineId(f.id)}
                            title={f.reason || f.type || 'Fine'}
                            detail={`${f.type || 'Fine'} · ${shortDate(f.date)} · ${money(f.remaining)} owed`}
                          />
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <p className="rounded-xl border border-rule px-4 py-3 text-sm">
                      <span className="font-medium">{fines[0].reason || fines[0].type || 'Fine'}</span>
                      <span className="text-muted">
                        {' '}
                        · {fines[0].type || 'Fine'} · {shortDate(fines[0].date)}
                      </span>
                    </p>
                  )}

                  {/* How much */}
                  <div>
                    <label htmlFor="pay-amount" className="mb-2 block text-sm font-semibold">
                      How much is he paying?
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="pay-amount"
                        ref={amountRef}
                        type="text"
                        inputMode="decimal"
                        value={amountText}
                        onChange={(e) => setAmountText(e.target.value)}
                        className="amount h-12 min-w-0 flex-1 rounded-xl border border-rule px-4 text-base"
                        aria-describedby="pay-amount-hint"
                      />
                      <button
                        type="button"
                        onClick={() => setAmountText(String(owed))}
                        disabled={!fineId}
                        className="min-h-12 shrink-0 rounded-xl border border-rule px-3 text-sm font-medium disabled:opacity-50"
                      >
                        Pay all {money(owed)}
                      </button>
                    </div>
                    <p id="pay-amount-hint" className="mt-1.5 text-xs text-muted">
                      {fineId
                        ? 'A smaller amount is a part payment — the rest of this fine stays owed.'
                        : 'Choose the fine first.'}
                    </p>
                  </div>

                  {/* How it was paid */}
                  <fieldset>
                    <legend className="mb-1 text-sm font-semibold">How was it paid?</legend>
                    <p className="mb-2 text-xs text-muted">
                      This decides whether his balance changes, so choose carefully.
                    </p>
                    <div role="radiogroup" aria-label="How it was paid" className="space-y-2">
                      <Choice
                        checked={source === 'balance'}
                        disabled={!balance.allowed || !fineId}
                        onSelect={() => setSource('balance')}
                        title="Take it from his balance"
                        detail={
                          balance.allowed
                            ? `The group already holds ${money(held)} for him. His balance goes down by what he pays.`
                            : balance.reason
                        }
                        tone={balance.allowed ? undefined : 'muted'}
                      />
                      <Choice
                        checked={source === 'cash'}
                        onSelect={() => setSource('cash')}
                        title="He paid in cash or M-Pesa"
                        detail="He handed the money over separately. His balance stays exactly as it is."
                      />
                    </div>
                  </fieldset>

                  {/* When */}
                  <div>
                    <label htmlFor="pay-date" className="mb-2 block text-sm font-semibold">
                      Date paid
                    </label>
                    <input
                      id="pay-date"
                      type="date"
                      max={todayISO()}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="h-12 w-full rounded-xl border border-rule px-3 text-base"
                    />
                    <p className="mt-1.5 text-xs text-muted">
                      The day the money was handed over — a payment recorded days later still belongs to the
                      meeting it was made at.
                    </p>
                  </div>

                  {/* What this will do */}
                  <div
                    aria-live="polite"
                    className={`rounded-xl px-4 py-3 text-sm ${
                      preview.valid ? 'bg-primary/10 text-primary' : 'bg-canvas text-muted'
                    }`}
                  >
                    {preview.valid ? (
                      <>
                        <p>
                          He will owe <span className="amount font-semibold">{money(preview.owedAfter)}</span> on this fine
                          after this.
                        </p>
                        {preview.heldAfter !== null && (
                          <p className="mt-0.5">
                            The group will hold <span className="amount font-semibold">{money(preview.heldAfter)}</span>{' '}
                            for him, down from {money(held)}.
                          </p>
                        )}
                        {source === 'cash' && <p className="mt-0.5">His balance of {money(held)} does not change.</p>}
                      </>
                    ) : (
                      <p>{preview.problem}</p>
                    )}
                  </div>
                </>
              )}
            </form>
          )}
        </div>

        <footer className="flex shrink-0 gap-3 border-t border-rule px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {result ? (
            <>
              {position && position.owed - result.totalApplied > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setSource(null);
                    setMemberId(null);
                    setPosition(null);
                    setTerm('');
                  }}
                  className="min-h-12 flex-1 rounded-xl border border-rule text-sm font-medium"
                >
                  Record another
                </button>
              )}
              <button
                type="button"
                onClick={close}
                className="min-h-12 flex-1 rounded-xl bg-primary text-sm font-semibold text-white"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                className="min-h-12 flex-1 rounded-xl border border-rule text-sm font-medium"
              >
                Cancel
              </button>
              {position && fines.length > 0 && (
                <button
                  type="submit"
                  form="pay-fines-form"
                  disabled={!preview.valid || busy}
                  className="min-h-12 flex-[2] rounded-xl bg-primary text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Recording…' : 'Record payment'}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </Modal>
  );
}

// One big, tappable answer. A radio in behaviour (and to a screen reader) but laid out as a card, so
// the explanation of what the choice does sits right beside it instead of in a tooltip.
function Choice({ checked, onSelect, title, detail, disabled = false, tone }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-14 w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
        checked ? 'border-primary bg-primary/5' : 'border-rule hover:bg-canvas'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          checked ? 'border-primary' : 'border-rule'
        }`}
      >
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className={`mt-0.5 block text-xs ${tone === 'muted' ? 'text-alert' : 'text-muted'}`}>{detail}</span>
      </span>
    </button>
  );
}
