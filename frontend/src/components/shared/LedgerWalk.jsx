import { useState } from 'react';
import { money, shortDate } from '../../utils/format';

// The working behind a member's figure, step by step — collapsed to a single line until somebody
// asks for it.
//
// It exists because every screen in this app shows a number with a sum under it ("carried in + paid
// in − tea") and stops there. The natural next question — this day he had 23,000, then 1,400 came in,
// then the week's tea came off, then a fine was charged: which of those got him to what he holds
// now? — had no answer on any screen, only in the treasurer's head.
//
// Two things it deliberately does NOT do:
//
//   * **It never clutters a page.** Collapsed by default, one line when closed, and it renders
//     nothing at all when there is nothing to explain (a record whose walk is a single step). Nobody
//     who does not want this ever sees it.
//   * **It never invents arithmetic.** Every figure comes from utils/ledgerWalk on the server, which
//     is built from the same rows and the same engine as the figure at the top of the page — and
//     `walk.balanced` says whether the two agree. When they do (they will: the walk *is* the engine),
//     the foot of the panel prints the sum in the same words the card above uses. If they ever do not,
//     this panel says so out loud rather than printing a second, quieter total.
//
// The fines keep their own column here, exactly as they are kept out of the money held: a fine
// charged steps "fines owed" up, a payment clearing it steps it back down, and the held figure is
// untouched by either. That is the rule the rest of the app keeps, so the panel states it in words
// instead of leaving a reader to conclude that paying a fine is money that went missing.
export default function LedgerWalk({ walk, className = '' }) {
  const [open, setOpen] = useState(false);

  // Nothing to explain: one step is just the carried-in line, and a payload with no walk at all
  // (built before this existed) draws nothing rather than an empty box.
  if (!walk || !Array.isArray(walk.steps) || walk.steps.length < 2) return null;

  const { closing, totals } = walk;

  return (
    <section className={`rounded-xl border border-rule bg-surface ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold">How this figure was worked out</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted">
            From week {walk.cycleStartWeek} to today, {walk.steps.length} steps — shown only when you
            ask.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="min-h-11 shrink-0 rounded-lg border border-rule px-3 text-sm font-medium text-primary"
        >
          {open ? 'Hide the working' : 'Show the working'}
        </button>
      </div>

      {open && (
        <>
          <ul className="border-t border-rule">
            {walk.steps.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-3 border-b border-rule px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="amount text-[11px] uppercase tracking-wide text-muted">
                    {shortDate(s.date)}
                    {s.weekNumber ? ` · week ${s.weekNumber}` : ''}
                  </p>
                  <p className="break-words text-sm">{s.label}</p>
                  {s.detail && (
                    <p className="mt-0.5 break-words text-xs leading-5 text-muted">{s.detail}</p>
                  )}
                </div>

                {/* What the step did, on the right where the running figure belongs. */}
                <div className="shrink-0 text-right">
                  {s.in > 0 && (
                    <p className="amount text-sm font-semibold text-accent">+{money(s.in)}</p>
                  )}
                  {s.out > 0 && (
                    <p className="amount text-sm font-semibold text-alert">−{money(s.out)}</p>
                  )}
                  {s.in === 0 && s.out === 0 && <p className="text-sm text-muted">—</p>}
                  {/* The fines column: money owed, never money off what he holds. */}
                  {s.owedIn > 0 && (
                    <p className="amount text-[11px] text-alert">fines owed +{money(s.owedIn)}</p>
                  )}
                  {s.owedOut > 0 && (
                    <p className="amount text-[11px] text-accent">fines owed −{money(s.owedOut)}</p>
                  )}
                  <p className="amount text-[11px] text-muted">
                    {s.effect ? `held ${money(s.held)}` : 'no change'}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="space-y-2 border-t border-rule px-4 py-3">
            {walk.balanced ? (
              <p className="amount text-sm leading-6">
                {money(totals.opening)} carried in + {money(totals.paidIn)} paid in −{' '}
                {money(totals.teaOff)} tea ={' '}
                <span className="font-semibold">{money(closing.held)}</span> held for him — the figure
                at the top of the page.
              </p>
            ) : (
              <p className="amount text-sm leading-6 text-alert">
                This working adds up to {money(closing.held)}, and the figure it explains reads{' '}
                {money(closing.money)}. One of the two is wrong — tell the office before anybody
                quotes either.
              </p>
            )}

            {closing.arrears > 0 && (
              <p className="amount text-sm leading-6 text-muted">
                {money(closing.arrears)} of the weeks that have closed is still unpaid
                {closing.weeksBehind > 0
                  ? ` (${closing.weeksBehind} week${closing.weeksBehind === 1 ? '' : 's'})`
                  : ''}
                . It is not taken off the money above, because it is money that never came in — the
                week table says which weeks.
              </p>
            )}

            {closing.finesOwed > 0 && (
              <p className="amount text-sm leading-6 text-muted">
                Fines still owing: {money(closing.finesOwed)}, kept on their own line — a fine is
                chased separately and does not come off the money the group holds.
              </p>
            )}

            <p className="text-xs leading-5 text-muted">
              Tea comes off every week that has closed, automatically, at {money(walk.teaPerWeek)} a
              week. This cycle&apos;s weekly contribution is {money(walk.weeklyAmount)}, and anything
              above it is still his money, not next week&apos;s payment.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
