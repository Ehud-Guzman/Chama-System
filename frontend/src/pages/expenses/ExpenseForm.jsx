import { money, shortDate, todayISO } from '../../utils/format';
import { Link } from 'react-router-dom';
import { fundLabel } from './shared';

export default function ExpenseForm({ amountRef, busy, cancelEdit, confirmOverdraw, data, editing, empty, form, funds, groupFund, holding, inCredit, overdraw, pickSource, selectedFund, set, setConfirmOverdraw, submit }) {
  return (
    <section className="rounded-xl border border-rule bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {editing
            ? `Correcting ${money(editing.amount)} on ${shortDate(editing.date)}`
            : 'Record an expense'}
        </h2>
        {editing && (
          <button
            type="button"
            onClick={cancelEdit}
            className="-my-1 min-h-11 rounded-lg px-2 text-sm font-medium text-primary"
          >
            Cancel
          </button>
        )}
      </div>

      {funds.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule px-4 py-6 text-center text-sm text-muted">
          No fund is set up to be spent from yet. Mark one on{' '}
          <Link to="/admin/finance/setup" className="text-primary underline">
            Finance → Setup
          </Link>{' '}
          first.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="expense-fund" className="mb-1 block text-xs font-medium">
                Spent from
              </label>
              <select
                id="expense-fund"
                value={form.source === 'group' ? 'group' : form.typeId || selectedFund?.id || ''}
                onChange={pickSource}
                className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              >
                {/* The group's own money first, because that is what a purchase the
                    group makes as a whole — land, a building — comes out of, and it
                    needs no fund to charge and no member's balance touched. */}
                <option value="group">
                  The group's total money — {money(holding.netBalance)} available
                </option>
                {/* Then the funds, ordered by what they hold, so the pot the money is
                    actually in comes next and the funds nothing has been collected
                    into yet sit under a heading of their own. */}
                {inCredit.map((f) => (
                  <option key={f.id} value={f.id}>
                    {fundLabel(f)}
                  </option>
                ))}
                {empty.length > 0 && (
                  <optgroup label="Nothing collected into these yet">
                    {empty.map((f) => (
                      <option key={f.id} value={f.id}>
                        {fundLabel(f)}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="amount mt-1 text-[11px] leading-4 text-muted">
                {form.source === 'group'
                  ? "Comes off the group's total money — what the members have contributed and the funds hold, less what has been spent. No fund is charged and no member's balance changes."
                  : `Spending comes off the fund picked here. The group's funds hold ${money(
                      groupFund.holds
                    )} altogether.`}
              </p>
            </div>
            <div>
              <label htmlFor="expense-amount" className="mb-1 block text-xs font-medium">
                Amount
              </label>
              <input
                id="expense-amount"
                ref={amountRef}
                type="text"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="0"
                className="amount h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-base font-semibold"
              />
            </div>
            <div>
              <label htmlFor="expense-date" className="mb-1 block text-xs font-medium">
                Date
              </label>
              <input
                id="expense-date"
                type="date"
                max={todayISO()}
                value={form.date}
                onChange={(e) => set('date', e.target.value)}
                className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="expense-description" className="mb-1 block text-xs font-medium">
                What it was for
              </label>
              <input
                id="expense-description"
                type="text"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="e.g. Tea and mandazi for the meeting"
                className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="expense-reference" className="mb-1 block text-xs font-medium">
                Voucher or receipt no.{' '}
                <span className="font-normal text-muted">— what the paperwork says</span>
              </label>
              <input
                id="expense-reference"
                type="text"
                value={form.reference}
                onChange={(e) => set('reference', e.target.value)}
                placeholder="e.g. VOUCHER 014"
                className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
              />
            </div>
          </div>

          {/* Only asked for above the group's spending limit, so nobody types an approval for the tea. */}
          {Number(data?.approvalLimit) > 0 && Number(form.amount) > Number(data.approvalLimit) && (
            <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
              <label htmlFor="expense-approval" className="mb-1 block text-xs font-medium">
                Approved in{' '}
                <span className="font-normal text-muted">
                  — above {money(data.approvalLimit)} the members must have agreed it. Which minute or meeting?
                </span>
              </label>
              <input
                id="expense-approval"
                type="text"
                value={form.approvalRef}
                onChange={(e) => set('approvalRef', e.target.value)}
                placeholder="e.g. Minutes of 12 Oct, item 4"
                className="h-12 w-full rounded-lg border border-rule bg-surface px-3 text-sm"
              />
            </div>
          )}

          <div>
            <label htmlFor="expense-note" className="mb-1 block text-xs font-medium">
              Note{' '}
              <span className="font-normal text-muted">
                — paste the M-Pesa message or say who was paid
              </span>
            </label>
            <textarea
              id="expense-note"
              rows={3}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="QDE7X1LMN Confirmed. Ksh500.00 paid to MAMA GRACE SUPPLIERS on 17/9/26."
              className="w-full rounded-lg border border-rule bg-canvas px-3 py-2 text-sm leading-5"
            />
          </div>

          {overdraw && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-alert/40 bg-alert/5 px-3 py-3 text-sm">
              <input
                type="checkbox"
                checked={confirmOverdraw}
                onChange={(e) => setConfirmOverdraw(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              <span>
                <span className="block font-semibold text-alert">
                  This is {money(overdraw.shortfall)} more than {overdraw.pot} holds
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  It holds {money(Math.max(0, overdraw.room))}. Tick to confirm you know, and the expense will be
                  recorded anyway and noted in the audit trail.
                </span>
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={busy || (Boolean(overdraw) && !confirmOverdraw)}
            className="min-h-12 w-full rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Saving…' : editing ? 'Save the correction' : 'Record the expense'}
          </button>
        </form>
      )}
    </section>
  );
}
