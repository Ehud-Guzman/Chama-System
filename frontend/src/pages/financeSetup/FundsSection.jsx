import { money } from '../../utils/format';

export default function FundsSection({ addFund, addingFund, data, funds, fundsTotal, locked, newFund, setFunds, setNewFund }) {
  return (
    <section className="overflow-hidden rounded-xl border border-rule bg-surface">
      <div className="border-b border-rule px-4 py-3">
        <h2 className="text-sm font-bold">Funds — what the group already holds (one-time)</h2>
        <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted">
          Each fund&rsquo;s own carry-in, the same idea as a member&rsquo;s balance: the tea float,
          registration money collected so far, anything the group was holding before this ledger
          started counting. A fund&rsquo;s balance on every screen is this figure plus what comes
          in minus what goes out — so a fund nobody carries in reads as empty. Digits only
          (1400 or 1,400 both work); a box you leave alone keeps the value it already has.
          {locked && <span className="ml-1 font-medium text-ink">Locked — unlock above to edit.</span>}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-rule bg-canvas">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">
                Fund
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">
                The ledger counts
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">
                Carried in
              </th>
            </tr>
          </thead>
          <tbody>
            {(data.funds || []).map((f) => {
              const differs = Number(funds[f.typeId] || 0) !== f.openingBalance;
              return (
                <tr key={f.typeId} className="border-b border-rule last:border-b-0">
                  <td className="px-4 py-2">
                    <p className="font-medium">
                      {f.name}
                      {!f.active && <span className="ml-2 text-xs text-muted">(inactive)</span>}
                    </p>
                    <p className="text-xs text-muted">
                      {[
                        f.isGroupFund
                          ? 'Group fund'
                          : 'Member money — carried in the members’ balances above',
                        f.tracksExpenses ? 'we spend from it' : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </td>
                  <td className="amount px-4 py-2 text-muted">
                    {money(f.collected + f.derived - f.spent)}
                    {f.derived > 0 && (
                      <span className="block text-xs">
                        includes {money(f.derived)} of automatic tea
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={funds[f.typeId] ?? ''}
                      onChange={(e) => setFunds({ ...funds, [f.typeId]: e.target.value })}
                      disabled={locked}
                      aria-label={`Carried-in total for ${f.name}`}
                      className={`amount h-11 w-36 rounded-lg border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
                        differs ? 'border-primary bg-primary/5' : 'border-rule bg-canvas'
                      }`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-rule bg-canvas">
            <tr>
              <td
                className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-muted"
                colSpan={2}
              >
                Total carried in
              </td>
              <td className="amount px-4 py-3 font-bold">{money(fundsTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Not a nested form: the page is one form, so this is plain fields and a
          button that posts on its own. */}
      <div className="flex flex-wrap items-end gap-3 border-t border-rule px-4 py-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="newFundName" className="mb-1 block text-xs font-medium">
            Add a fund the group collects — registration, resignation, welfare…
          </label>
          <input
            id="newFundName"
            value={newFund.name}
            onChange={(e) => setNewFund({ ...newFund, name: e.target.value })}
            placeholder="Registration"
            className="h-12 w-full rounded-lg border border-rule bg-canvas px-3 text-sm"
          />
        </div>

        <label className="flex min-h-12 items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={newFund.isGroupFund}
            onChange={(e) => setNewFund({ ...newFund, isGroupFund: e.target.checked })}
            className="h-4 w-4"
          />
          Belongs to the group
        </label>

        <label className="flex min-h-12 items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={newFund.tracksExpenses}
            onChange={(e) => setNewFund({ ...newFund, tracksExpenses: e.target.checked })}
            className="h-4 w-4"
          />
          We spend from it
        </label>

        <button
          type="button"
          onClick={addFund}
          disabled={addingFund}
          className="min-h-11 rounded-lg border border-rule px-4 text-sm font-medium disabled:opacity-60"
        >
          {addingFund ? 'Adding…' : 'Add fund'}
        </button>
      </div>
    </section>
  );
}
