import { money } from '../../utils/format';
import WhoOwesWhat from '../../components/fines/WhoOwesWhat';

export default function GroupFineRecord({ exportGroup, group, groupBusy, groupExporting }) {
  return (
    <section className="overflow-hidden rounded-xl border border-rule bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            {group.scopeLabel} — the whole group
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {group.totals.count} on record
            {group.totals.membersOwing > 0
              ? ` · ${group.totals.membersOwing} member${group.totals.membersOwing === 1 ? '' : 's'} owing`
              : ' · nobody owes a fine'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => exportGroup('pdf')}
            disabled={groupExporting !== null}
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {groupExporting === 'pdf' ? 'Preparing…' : 'Group PDF'}
          </button>

          <button
            type="button"
            onClick={() => exportGroup('xlsx')}
            disabled={groupExporting !== null}
            className="min-h-11 rounded-lg border border-rule px-4 text-sm font-semibold disabled:opacity-60"
          >
            {groupExporting === 'xlsx' ? 'Preparing…' : 'Group Excel'}
          </button>
        </div>
      </div>

      {groupBusy && !group.totals.count ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Loading the group record…</p>
      ) : group.totals.count === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          No fines have been issued yet, so there is nothing to report on.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px border-b border-rule bg-rule md:grid-cols-3">
            <div className="min-w-0 bg-surface px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Issued in total
              </dt>
              <dd className="amount mt-0.5 break-words text-sm font-bold">
                {money(group.totals.issued)}
              </dd>
              <dd className="amount text-xs text-muted">{group.totals.count} fines</dd>
            </div>

            <div className="min-w-0 bg-surface px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Paid off
              </dt>
              <dd className="amount mt-0.5 break-words text-sm font-bold text-accent">
                {money(group.totals.cleared)}
              </dd>
              <dd className="amount text-xs text-muted">
                {group.totals.clearedCount} cleared
              </dd>
            </div>

            <div className="min-w-0 bg-surface px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Still owed
              </dt>
              <dd
                className={`amount mt-0.5 break-words text-sm font-bold ${
                  group.totals.outstanding > 0 ? 'text-alert' : ''
                }`}
              >
                {money(group.totals.outstanding)}
              </dd>
              <dd className="amount text-xs text-muted">
                {group.totals.pendingCount} not cleared
              </dd>
            </div>
          </dl>

          {group.byType.length > 0 && (
            <div className="border-b border-rule px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                By fine type
              </p>
              <ul className="mt-2 space-y-2">
                {group.byType.map((type) => (
                  <li
                    key={type.name}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {type.name}
                      <span className="ml-1 text-[11px] uppercase tracking-wide text-muted">
                        {type.category}
                      </span>
                    </span>
                    <span className="amount shrink-0 text-right font-medium">
                      {money(type.issued)}
                      {type.outstanding > 0 && (
                        <span className="block text-[11px] font-normal text-alert">
                          {money(type.outstanding)} owed
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* The same list the office reads on the reports screen: searchable, in the
              order needed today, and every member's own breakdown on a tap. It used
              to stop at ten names here, which is the wrong answer on the morning a
              committee asks for the whole list. */}
          {group.byMember.some((m) => m.outstanding > 0) && (
            <div className="border-b border-rule px-4 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
                Who owes what
              </p>
              <WhoOwesWhat
                members={group.byMember}
                totals={group.totals}
                note="Every member in this category of fines. Settling one is the office's job, from the member's page."
              />
            </div>
          )}

          {group.byMonth.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Month by month
              </p>
              <ul className="mt-2 space-y-2">
                {group.byMonth.slice(0, 12).map((month) => (
                  <li
                    key={month.month}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="amount">{month.month}</span>
                    <span className="amount shrink-0 text-right font-medium">
                      {money(month.issued)}
                      <span className="block text-[11px] font-normal text-muted">
                        {month.count} issued
                        {month.outstanding > 0
                          ? ` · ${money(month.outstanding)} owed`
                          : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
