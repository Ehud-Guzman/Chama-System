import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import Modal from '../shared/Modal';
import { useModal } from '../../hooks/useModal';
import { money, shortDate, todayISO } from '../../utils/format';
import { paymentPreview, paymentSummary, paymentMessage } from '../../utils/finePayment';
import { searchOwed } from '../../utils/finesOwed';
import { whatsappLink } from '../../utils/whatsapp';

// Recording a fine payment, start to finish, in one place.
//
// Pay clears everything the member owes in fines in one go, oldest fine first, out of the money the
// group holds for him — and each fine is still listed with its own line, so the office and the member
// can see every one was paid. The dialog opens over whatever the office is looking at and walks the
// way a meeting does:
//
//   1. who is paying (skipped when it was opened from a member),
//   2. how it was paid: taken out of his balance, or handed over separately. This is the one
//      question that decides whether his balance moves, so it is asked in plain words. It starts on
//      his balance when that covers every fine, and is left for the office to choose when it does not.
//
// Nothing is recorded until the summary under the form reads right, and when it is recorded the
// dialog lists each fine with what was paid on it.
export default function PayFinesModal({
  memberId: initialMemberId = null,
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
  // One key per payment being recorded, so a submit sent twice (a dropped connection, two taps) is
  // recorded once. A new one is made when the dialog moves on to another payment.
  const requestKey = useRef(newRequestKey());

  const [memberId, setMemberId] = useState(initialMemberId);
  const [term, setTerm] = useState('');
  const [position, setPosition] = useState(null);
  const [loadError, setLoadError] = useState('');
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
        // His balance is the way fines are normally paid, so it is ready when it covers them all.
        // Short of that, how to make up the difference is the office's call.
        setSource(res.data.held >= res.data.owed && res.data.owed > 0 ? 'balance' : null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(apiMessage(err, 'Could not load this member'));
      });
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  const fines = position?.fines || [];
  const held = position?.held || 0;

  const preview = useMemo(
    () => paymentPreview({ fines, held, source, paidOn: date }),
    [fines, held, source, date]
  );
  const candidates = useMemo(() => searchOwed(owingMembers, term, 'name').slice(0, 40), [owingMembers, term]);

  async function submit(e) {
    e.preventDefault();
    if (!preview.valid || busy) return;
    setBusy(true);
    try {
      const res = await api.post(`/api/fines/member/${memberId}/pay`, {
        source,
        date,
        clientRequestId: requestKey.current,
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
                    <span className="min-w-0">
                      <span className="block truncate">{f.reason || f.type || 'Fine'}</span>
                      <span className="block text-xs text-muted">{shortDate(f.date)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="amount block font-semibold text-primary">{money(f.paid)} paid</span>
                      <span className="amount block text-xs text-muted">
                        {f.remaining > 0 ? `${money(f.remaining)} still owed` : 'cleared'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {position.member.canEmail ? (
                <p className="text-xs text-muted">
                  He is being emailed an acknowledgement. A payment keyed in by mistake can be taken back from
                  the fine’s history.
                </p>
              ) : (
                <p className="text-xs text-muted">
                  He has no email address the system can use, so he has not been told. A payment keyed in by
                  mistake can be taken back from the fine’s history.
                </p>
              )}
              {(() => {
                const link = whatsappLink(
                  position.member.phone,
                  paymentMessage({
                    memberName: position.member.name,
                    totalApplied: result.totalApplied,
                    source: result.source,
                    held: result.held,
                    owedAfter: result.owedAfter,
                  })
                );
                return link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-12 w-full items-center justify-center rounded-xl border border-primary text-sm font-semibold text-primary"
                  >
                    Tell him on WhatsApp
                  </a>
                ) : null;
              })()}
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

                  {/* Every fine he owes, oldest first, with what this payment will do to each. */}
                  <div>
                    <p className="mb-2 text-sm font-semibold">
                      {fines.length === 1 ? 'The fine he owes' : `All ${fines.length} fines he owes`}
                    </p>
                    <ul className="divide-y divide-rule rounded-xl border border-rule">
                      {preview.rows.length > 0
                        ? preview.rows.map((f) => (
                            <FineLine
                              key={f.id}
                              fine={f}
                              paying={f.paying}
                              remainingAfter={f.remainingAfter}
                              later={f.later}
                            />
                          ))
                        : fines.map((f) => (
                            <FineLine key={f.id} fine={f} paying={0} remainingAfter={f.remaining} />
                          ))}
                    </ul>
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
                        disabled={held <= 0}
                        onSelect={() => setSource('balance')}
                        title="Take it from his balance"
                        detail={
                          held <= 0
                            ? 'The group is not holding any money for him, so there is nothing to take it from.'
                            : held >= position.owed
                              ? `The group already holds ${money(held)} for him. His balance goes down by what he pays.`
                              : `The group holds only ${money(held)} for him. The oldest fines are cleared with that, and the rest stay owed.`
                        }
                        tone={held <= 0 ? 'muted' : undefined}
                      />
                      <Choice
                        checked={source === 'cash'}
                        onSelect={() => setSource('cash')}
                        title="He paid in cash or M-Pesa"
                        detail="He handed the money over separately. Every fine is cleared and his balance stays exactly as it is."
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
                          <span className="amount font-semibold">{money(preview.total)}</span> will be paid across{' '}
                          {preview.rows.filter((r) => r.paying > 0).length === 1
                            ? '1 fine'
                            : `${preview.rows.filter((r) => r.paying > 0).length} fines`}
                          .{' '}
                          {preview.owedAfter > 0 ? (
                            <>
                              He will still owe <span className="amount font-semibold">{money(preview.owedAfter)}</span>.
                            </>
                          ) : (
                            'He will owe no more fines.'
                          )}
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
                    requestKey.current = newRequestKey();
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
                  {busy ? 'Recording…' : preview.valid ? `Pay ${money(preview.total)}` : 'Pay'}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </Modal>
  );
}

// A new random key for one payment. `crypto.randomUUID` is missing on plain-http pages, so there is a
// fallback; the key only has to be different from the last payment's.
function newRequestKey() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `pay-${id}`;
}

// One fine in the list: what it is, and what this payment will take off it.
function FineLine({ fine, paying, remainingAfter, later = false }) {
  return (
    <li className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
      <span className="min-w-0">
        <span className="block truncate font-medium">{fine.reason || fine.type || 'Fine'}</span>
        <span className="block text-xs text-muted">
          {fine.type || 'Fine'} · {shortDate(fine.date)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="amount block font-semibold">{money(fine.remaining)}</span>
        {later && <span className="block text-xs text-muted">issued after the date paid</span>}
        {paying > 0 && (
          <span className="amount block text-xs text-primary">
            {remainingAfter > 0 ? `${money(paying)} paid, ${money(remainingAfter)} left` : 'paid in full'}
          </span>
        )}
      </span>
    </li>
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
