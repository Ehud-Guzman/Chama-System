import { shortDate, money, todayISO, METHOD_LABELS } from '../../utils/format';
import { KINDS, METHODS } from './shared';

export default function AddLogForm({ amount, amountRef, busy, coverArrears, data, date, description, duplicate, firstShortWeek, kind, ledger, method, note, pasted, selectedWeek, setAmount, setDate, setDescription, setDuplicate, setKind, setMethod, setNote, setTargetWeek, submit, weekDue }) {
  return (
    <form
      onSubmit={submit}
      className="min-w-0 space-y-4 rounded-xl border border-rule bg-surface p-4"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Add a log</p>
        <p className="mt-1 text-sm text-muted">
          {KINDS.find((k) => k.value === kind)?.hint}
        </p>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium">Which week is this for?</legend>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {[...ledger.weeks].reverse().map((w) => {
            const isPicked = selectedWeek?.weekNumber === w.weekNumber;
            return (
              <button
                key={w.weekNumber}
                type="button"
                onClick={() => setTargetWeek(w.weekNumber)}
                aria-pressed={isPicked}
                title={`${shortDate(w.startDate)} → ${shortDate(w.endDate)}`}
                className={`min-w-20 shrink-0 rounded-lg border px-3 py-2 text-center ${
                  isPicked ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
                }`}
              >
                <span className="amount block text-sm font-bold">W{w.weekNumber}</span>
                <span className="mt-0.5 block text-[11px] uppercase tracking-wide">
                  {w.isBaseline
                    ? 'opening'
                    : w.isCurrent
                      ? 'now'
                      : w.settled
                        ? 'settled'
                        : 'owing'}
                </span>
              </button>
            );
          })}
        </div>
        {selectedWeek && (
          <p className="mt-2 text-xs text-muted">
            Logging against week {selectedWeek.weekNumber} ({shortDate(selectedWeek.startDate)} →{' '}
            {shortDate(selectedWeek.endDate)})
            {selectedWeek.isBaseline
              ? ` — the opening week. Nothing was due for it, because his money for it is the ${money(
                  ledger.openingBalance
                )} he carried in; the week's ${money(
                  ledger.weeklyAmount
                )} is still collected, and it is simply his money against week ${
                  selectedWeek.weekNumber + 1
                }.`
              : selectedWeek.isCurrent
                ? ` — the week running now. Its ${money(
                    ledger.weeklyAmount
                  )} is only counted the day after it closes, so logging it here is what settles it.`
                : selectedWeek.settled
                  ? ' — already settled, so anything logged now is simply more of his money.'
                  : ` — ${money(weekDue)} of the ${money(ledger.weeklyAmount)} still due.`}
          </p>
        )}
        {data.history?.length > 0 && (
          <p className="mt-2 text-xs leading-5 text-muted">
            Weeks 1–{data.history[data.history.length - 1].weekNumber} are listed on the week table
            below for reference. They ran before this ledger opened and their money is already
            inside his brought-forward balance, so they are not scored — to correct one of those
            weeks, change his opening balance instead.
          </p>
        )}
      </fieldset>

      {ledger.chasedWeeksBehind > 0 && firstShortWeek && (
        <button
          type="button"
          onClick={coverArrears}
          className="min-h-11 w-full rounded-lg border border-alert/40 bg-alert/5 px-3 text-xs font-semibold text-alert"
        >
          Week {firstShortWeek.weekNumber} is {money(firstShortWeek.shortfall)} short — log it
          {ledger.chasedWeeksBehind > 1
            ? ` (${ledger.chasedWeeksBehind} closed weeks unpaid — one line each, in its own week)`
            : ''}
        </button>
      )}
      {/* Above the group's line the uncollected week is not chased (utils/reminderLimit): the
          treasurer still needs to see it, and to be able to log it when the member brings it —
          so the button stays, and what changes is that it no longer calls him behind. */}
      {(ledger.chasedArrears ?? ledger.arrears) === 0 && ledger.arrears > 0 && (
        <button
          type="button"
          onClick={coverArrears}
          className="min-h-11 w-full rounded-lg border border-rule bg-canvas px-3 text-xs font-semibold text-muted"
        >
          Ahead of the cycle — {ledger.weeksBehind} closed week
          {ledger.weeksBehind === 1 ? '' : 's'} uncollected ({money(ledger.arrears)}), not chased
          {ledger.moneyLimit > 0 ? ` above ${money(ledger.moneyLimit)}` : ''} — log it when he
          brings it
        </button>
      )}

      <fieldset>
        <legend className="mb-2 text-xs font-medium">What is this?</legend>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              aria-pressed={kind === k.value}
              className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${
                kind === k.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-rule text-muted'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="log-amount" className="mb-1 block text-xs font-medium">
            Amount
          </label>
          <input
            id="log-amount"
            ref={amountRef}
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="amount h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-base font-semibold"
          />
        </div>
        <div>
          <label htmlFor="log-date" className="mb-1 block text-xs font-medium">
            Date
          </label>
          <input
            id="log-date"
            type="date"
            max={todayISO()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
          />
        </div>
      </div>

      {kind === 'weekly' && weekDue === 0 && (
        <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
          That week is already settled. Anything logged now is more of his money.
        </p>
      )}

      <fieldset>
        <legend className="mb-2 text-xs font-medium">Paid by</legend>
        <div className="grid grid-cols-4 gap-2">
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              aria-pressed={method === m}
              className={`min-h-11 rounded-lg border text-xs font-semibold ${
                method === m ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
              }`}
            >
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      </fieldset>

      {kind === 'expense' && (
        <div>
          <label htmlFor="log-description" className="mb-1 block text-xs font-medium">
            What was it for?
          </label>
          <input
            id="log-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Tea and mandazi"
            className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
          />
        </div>
      )}

      <div>
        <label htmlFor="log-note" className="mb-1 block text-xs font-medium">
          Note <span className="font-normal text-muted">— paste the M-Pesa or bank message here</span>
        </label>
        <textarea
          id="log-note"
          rows={4}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setDuplicate('');
          }}
          placeholder="SK9X2Q1LMN Confirmed. Ksh1,400.00 sent to WAZO MOJA SELF-HELP GROUP on 17/9/26 at 8:04 AM."
          className="w-full rounded-lg border border-rule bg-canvas px-3 py-2 text-sm leading-5"
        />
      </div>

      {/* The amount on a pasted M-Pesa message, offered rather than applied: a message can be
          about something else, and the figure the treasurer typed is the one he meant. */}
      {pasted.amount && pasted.amount !== Number(String(amount).replace(/[,\s]/g, '')) && (
        <button
          type="button"
          onClick={() => setAmount(String(pasted.amount))}
          className="min-h-11 w-full rounded-lg border border-rule px-3 text-left text-sm"
        >
          The message says <span className="amount font-semibold">{money(pasted.amount)}</span>
          {pasted.code ? ` (${pasted.code})` : ''}. <span className="font-medium text-primary">Use that amount</span>
        </button>
      )}

      {duplicate && (
        <div role="alert" className="rounded-lg border border-alert/30 bg-alert/5 px-3 py-3 text-sm">
          <p className="text-alert">{duplicate}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setDuplicate('')}
              className="min-h-11 flex-1 rounded-lg border border-rule bg-surface text-sm font-medium"
            >
              Do not log it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => submit(null, true)}
              className="min-h-11 flex-1 rounded-lg bg-alert text-sm font-semibold text-white disabled:opacity-60"
            >
              It is a second payment
            </button>
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="min-h-12 w-full rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Logging…' : 'Log it'}
      </button>
    </form>
  );
}
