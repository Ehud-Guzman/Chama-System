import { money } from '../../utils/format';

export default function OpeningBalancesSection({ balances, data, enteredTotal, locked, setBalances, storedMembersTotal, useSuggestions }) {
  return (
    <section className="overflow-hidden rounded-xl border border-rule bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <div>
          <h2 className="text-sm font-bold">
            Opening balances (what each member held when these books opened)
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            What each member held on the paper ledger when this started. It is the base every
            later week is added to. Type figures as digits — 1400 and 1,400 both work — and a box
            you leave alone keeps the value it already has.
            {/* On a phone these boxes are a scroll away from the lock bar, so the reason
                they cannot be typed into travels with them. */}
            {locked && <span className="ml-1 font-medium text-ink">Locked — unlock above to edit.</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={useSuggestions}
          disabled={locked}
          title={locked ? 'Unlock to edit first' : undefined}
          className="min-h-11 rounded-lg border border-rule px-4 text-sm font-medium disabled:opacity-60"
        >
          Use all suggestions
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-rule bg-canvas">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">
                Member
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">
                From the ledger
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">
                Opening balance
              </th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => {
              const differs = Number(balances[m._id] || 0) !== m.suggested;
              return (
                <tr key={m._id} className="border-b border-rule last:border-b-0">
                  <td className="px-4 py-2">
                    <p className="font-medium">
                      {m.name}
                      {!m.active && <span className="ml-2 text-xs text-muted">(inactive)</span>}
                    </p>
                    <p className="text-xs text-muted">{m.regNumber || ''}</p>
                  </td>
                  <td className="amount px-4 py-2 text-muted">{money(m.suggested)}</td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={balances[m._id] ?? ''}
                      onChange={(e) => setBalances({ ...balances, [m._id]: e.target.value })}
                      disabled={locked}
                      aria-label={`Opening balance for ${m.name}`}
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
              <td className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-muted" colSpan={2}>
                Total entered
              </td>
              <td className="px-4 py-3">
                <p className="amount font-bold">{money(enteredTotal)}</p>
                {enteredTotal !== storedMembersTotal && (
                  <p className="amount text-xs text-muted">
                    saved now: {money(storedMembersTotal)}
                  </p>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
