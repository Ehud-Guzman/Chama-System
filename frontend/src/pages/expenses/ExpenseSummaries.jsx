import { money } from '../../utils/format';
import { monthLabel } from './shared';

export default function ExpenseSummaries({ byFund, byMonth }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Where the money in each fund has gone. A fund that no longer exists still
          appears if it has spending against it, so nothing vanishes from the total. */}
      <section className="overflow-hidden rounded-xl border border-rule bg-surface">
        <h2 className="border-b border-rule px-4 py-3 text-sm font-semibold">
          How each fund stands
        </h2>
        {byFund.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Nothing spent yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-[11px] uppercase tracking-widest text-muted">
                <th className="px-4 py-2 font-semibold">Fund</th>
                <th className="amount px-2 py-2 text-right font-semibold">In</th>
                <th className="amount px-2 py-2 text-right font-semibold">Out</th>
                <th className="amount px-4 py-2 text-right font-semibold">Holds</th>
              </tr>
            </thead>
            <tbody>
              {byFund.map((f) => (
                <tr key={f.name} className="border-b border-rule last:border-b-0">
                  <td className="px-4 py-2">
                    <span className="font-medium">{f.name}</span>
                    {f.advances > 0 && (
                      <span className="block text-[11px] text-muted">
                        {money(f.advances)} of that is a loan, still owed back
                      </span>
                    )}
                  </td>
                  <td className="amount px-2 py-2 text-right">
                    {money(f.contributed + f.carriedIn + f.derived)}
                  </td>
                  <td className="amount px-2 py-2 text-right text-alert">{money(f.spent)}</td>
                  <td className="amount px-4 py-2 text-right font-semibold">{money(f.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-rule bg-surface">
        <h2 className="border-b border-rule px-4 py-3 text-sm font-semibold">
          Spending by month
        </h2>
        {byMonth.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">
            Nothing spent yet, so there is nothing to chart.
          </p>
        ) : (
          <ul>
            {byMonth.map((m) => (
              <li
                key={m.month}
                className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5 text-sm last:border-b-0"
              >
                <span>{monthLabel(m.month)}</span>
                <span className="text-xs text-muted">
                  {m.count} {m.count === 1 ? 'entry' : 'entries'}
                </span>
                <span className="amount font-semibold text-alert">{money(m.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
