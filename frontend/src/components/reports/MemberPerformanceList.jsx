import { money, shortDate } from '../../utils/format';
import { whatsappLink } from '../../utils/messaging';

function consistencyClass(pct) {
  if (pct === null || pct === undefined) return 'text-muted';
  if (pct >= 80) return 'text-accent';
  if (pct >= 50) return 'text-primary';
  return 'text-alert';
}

// Somebody who is behind, or who owes a fine, is the one worth messaging.
function needsNudge(member) {
  return (member.consistency !== null && member.consistency < 80) || member.pendingFines > 0;
}

function reminderMessage(member) {
  return `Hi ${member.name.split(' ')[0]}, this is a reminder from the chama.${
    member.pendingFines > 0 ? ` You have ${money(member.pendingFines)} in unpaid fines.` : ''
  }`;
}

// The member performance list, in two shapes.
//
// Cards on a phone and a table from md up: the table wants about 700px, and on a
// 360px screen it becomes a horizontal scroll with the member's name off-screen —
// the one column you cannot afford to lose. Both shapes open the same chart.
export default function MemberPerformanceList({ members, onOpenChart }) {
  return (
    <>
      {/* Phone: one card each, nothing to scroll sideways */}
      <ul className="space-y-2 md:hidden">
        {members.map((m) => (
          <li key={m.memberId} className="rounded-xl border border-rule bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{m.name}</p>
                {m.regNumber && <p className="amount text-xs text-muted">{m.regNumber}</p>}
              </div>

              <div className="shrink-0 text-right">
                <p className="amount font-semibold">{money(m.totalContributed)}</p>
                {m.carriedIn > 0 && (
                  <p className="amount text-[11px] text-muted">
                    incl. {money(m.carriedIn)} carried in
                  </p>
                )}
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-rule pt-3 text-xs">
              <div className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Weeks
                </dt>
                <dd className="amount mt-0.5">
                  {m.weeksPaid}/{m.weeksExpected}
                  {m.weeksPartial > 0 && <span className="text-muted"> +{m.weeksPartial}</span>}
                </dd>
              </div>

              <div className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Consistency
                </dt>
                <dd className={`amount mt-0.5 font-semibold ${consistencyClass(m.consistency)}`}>
                  {m.consistency === null ? '—' : `${m.consistency}%`}
                </dd>
              </div>

              <div className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Fines owed
                </dt>
                <dd
                  className={`amount mt-0.5 ${m.pendingFines > 0 ? 'text-alert' : 'text-muted'}`}
                >
                  {m.pendingFines > 0 ? money(m.pendingFines) : '—'}
                </dd>
              </div>
            </dl>

            <p className="amount mt-2 text-[11px] text-muted">
              Last paid {shortDate(m.lastContributionDate)}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onOpenChart(m)}
                className="min-h-11 flex-1 rounded-lg bg-primary px-3 text-sm font-semibold text-white"
              >
                View chart
              </button>

              {needsNudge(m) && (
                <a
                  href={whatsappLink(m.phone, reminderMessage(m))}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-rule px-3 text-sm font-medium text-primary"
                >
                  Remind
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Tablet and up: the same figures in one table */}
      <div className="hidden overflow-hidden rounded-xl border border-rule bg-surface md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-[10px] font-semibold uppercase tracking-widest text-muted">
              <th className="px-3 py-2">Member</th>
              <th className="px-3 py-2 text-right">Total (all-time)</th>
              <th className="px-3 py-2 text-right">Weeks paid</th>
              <th className="px-3 py-2 text-right">Consistency</th>
              <th className="px-3 py-2 text-right">Fines owed</th>
              <th className="px-3 py-2 text-right">Last contribution</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>

          <tbody>
            {members.map((m) => (
              <tr
                key={m.memberId}
                className="border-b border-rule last:border-b-0 hover:bg-canvas/60"
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpenChart(m)}
                    className="max-w-full truncate text-left font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {m.name}
                  </button>
                  {m.regNumber && <p className="amount text-xs text-muted">{m.regNumber}</p>}
                </td>

                <td className="amount px-3 py-2 text-right font-semibold">
                  {money(m.totalContributed)}
                  {/* All-time includes the balance he carried in when the books
                      opened, since no contribution row can show it — without that
                      line the figure looks invented. */}
                  {m.carriedIn > 0 && (
                    <p className="text-xs font-normal text-muted">
                      incl. {money(m.carriedIn)} carried forward
                    </p>
                  )}
                </td>

                <td className="amount px-3 py-2 text-right text-muted">
                  {m.weeksPaid}/{m.weeksExpected}
                  {m.weeksPartial > 0 ? ` (+${m.weeksPartial} partial)` : ''}
                </td>

                <td
                  className={`amount px-3 py-2 text-right font-semibold ${consistencyClass(m.consistency)}`}
                >
                  {m.consistency === null ? '—' : `${m.consistency}%`}
                </td>

                <td className="amount px-3 py-2 text-right">
                  {m.pendingFines > 0 ? (
                    <span className="text-alert">{money(m.pendingFines)}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>

                <td className="amount px-3 py-2 text-right text-xs text-muted">
                  {shortDate(m.lastContributionDate)}
                </td>

                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => onOpenChart(m)}
                      className="text-xs font-medium text-primary"
                    >
                      Chart
                    </button>

                    {needsNudge(m) && (
                      <a
                        href={whatsappLink(m.phone, reminderMessage(m))}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-primary"
                      >
                        Remind
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
