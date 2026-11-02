import { money } from '../../utils/format';
import { Link } from 'react-router-dom';
import Loader from '../../components/shared/Loader';
import WhoOwesWhat from '../../components/fines/WhoOwesWhat';

export default function FinesTab({ fines, mayWorkFines }) {
  return (
    <section className="space-y-4">
      {/* The report says what is owed; the desk at /admin/fines is where it is
          worked — but only for the roles the API lets work it, so a treasurer or a
          secretary is not sent to a screen that would refuse him. */}
      {mayWorkFines && (
        <div className="flex justify-end">
          <Link
            to="/admin/fines"
            className="min-h-11 rounded-xl border border-rule bg-surface px-4 text-sm font-semibold leading-[2.75rem] text-primary"
          >
            Issue or collect →
          </Link>
        </div>
      )}
      {!fines ? (
        <Loader />
      ) : fines.totals.count === 0 ? (
        <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
          No fines have been issued.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Still owed
              </p>
              <p
                className={`amount mt-0.5 truncate text-lg font-bold ${
                  fines.totals.outstanding > 0 ? "text-alert" : ""
                }`}
              >
                {money(fines.totals.outstanding)}
              </p>
              <p className="amount text-[11px] text-muted">
                {fines.totals.pendingCount} fines
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Issued in total
              </p>
              <p className="amount mt-0.5 truncate text-lg font-bold">
                {money(fines.totals.issued)}
              </p>
              <p className="amount text-[11px] text-muted">{fines.totals.count} fines</p>
            </div>

            <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Paid off
              </p>
              <p className="amount mt-0.5 truncate text-lg font-bold text-accent">
                {money(fines.totals.cleared)}
              </p>
              <p className="amount text-[11px] text-muted">
                {fines.totals.clearedCount} cleared
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-rule bg-surface px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Share cleared
              </p>
              <p className="amount mt-0.5 text-lg font-bold">
                {Math.round(
                  (fines.totals.cleared / Math.max(fines.totals.issued, 1)) * 100,
                )}
                %
              </p>
              <p className="text-[11px] text-muted">of everything issued</p>
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
              By fine type
            </h2>
            <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
              {fines.byType.map((t) => (
                <li key={t.name} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {t.name}
                      <span className="ml-1 text-[11px] uppercase tracking-wide text-muted">
                        {t.category}
                      </span>
                    </span>
                    <span className="amount shrink-0 text-sm font-semibold">
                      {money(t.issued)}
                    </span>
                  </div>
                  <p className="amount mt-0.5 text-[11px] text-muted">
                    {t.count} issued
                    {t.outstanding > 0 ? (
                      <span className="text-alert"> · {money(t.outstanding)} still owed</span>
                    ) : (
                      " · all cleared"
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
                Who owes what
              </h2>
              <WhoOwesWhat
                members={fines.byMember}
                totals={fines.totals}
                truncated={fines.byMemberTruncated}
                limit={fines.byMemberLimit}
                note="Tap a member to see what he owes it for. The export carries every one, with the phone numbers."
              />
            </div>

            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
                Month by month
              </h2>
              <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
                {fines.byMonth.map((m) => (
                  <li
                    key={m.month}
                    className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="amount text-sm">{m.month}</span>
                    <span className="amount text-right text-sm font-semibold">
                      {money(m.issued)}
                      <span className="block text-[11px] font-normal text-muted">
                        {m.count} issued
                        {m.outstanding > 0 ? ` · ${money(m.outstanding)} owed` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
