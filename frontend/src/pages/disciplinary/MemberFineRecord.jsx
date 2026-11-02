import { money, shortDate } from '../../utils/format';

export default function MemberFineRecord({ exportRecord, exporting, record, recordBusy, selectedMember }) {
  return (
    <section className="overflow-hidden rounded-xl border border-rule bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            Fine record — {selectedMember.name}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {record?.scopeLabel || 'Disciplinary fines'}
            {record ? ` · ${record.summary.count} on record` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => exportRecord('pdf')}
            disabled={!record || exporting !== null}
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {exporting === 'pdf' ? 'Preparing…' : 'Download PDF'}
          </button>

          <button
            type="button"
            onClick={() => exportRecord('xlsx')}
            disabled={!record || exporting !== null}
            className="min-h-11 rounded-lg border border-rule px-4 text-sm font-semibold disabled:opacity-60"
          >
            {exporting === 'xlsx' ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {recordBusy && !record ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Loading his fines…</p>
      ) : !record || record.summary.count === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          No disciplinary fines on record for this member.
        </p>
      ) : (
        <>
          {/* Two per row on a phone. Three columns left the money about 80px
              wide and these figures carried a `truncate`, so "Still owed" showed
              an ellipsis where the amount should be. The hairlines come from the
              gap showing the rule colour, which keeps them correct at any count. */}
          <dl className="grid grid-cols-2 gap-px border-b border-rule bg-rule md:grid-cols-3">
            <div className="min-w-0 bg-surface px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                On record
              </dt>
              <dd className="amount mt-0.5 text-sm font-bold">
                {record.summary.count}
              </dd>
              <dd className="amount text-xs text-muted">
                ({money(record.summary.issued)} raised in fines)
              </dd>
            </div>

            <div className="min-w-0 bg-surface px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Still owed
              </dt>
              <dd
                className={`amount mt-0.5 break-words text-sm font-bold ${
                  record.summary.outstanding > 0 ? 'text-alert' : ''
                }`}
              >
                {money(record.summary.outstanding)}
              </dd>
              <dd className="amount text-xs text-muted">
                ({record.summary.pendingCount} fines not cleared)
              </dd>
            </div>

            <div className="min-w-0 bg-surface px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Paid off
              </dt>
              <dd className="amount mt-0.5 break-words text-sm font-bold text-accent">
                {money(record.summary.cleared)}
              </dd>
              <dd className="amount text-xs text-muted">
                ({record.summary.clearedCount} fines paid off)
              </dd>
            </div>
          </dl>

          <ul className="divide-y divide-rule">
            {record.fines.map((fine) => (
              <li key={fine.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {fine.type}
                    {fine.category === 'disciplinary' && (
                      <span className="ml-1 text-[11px] uppercase tracking-wide text-muted">
                        conduct
                      </span>
                    )}
                  </p>
                  <p className="amount shrink-0 text-sm font-semibold">
                    {money(fine.amount)}
                  </p>
                </div>

                <p className="amount mt-0.5 text-xs text-muted">
                  {shortDate(fine.date)} ·{' '}
                  {fine.status === 'pending' ? (
                    <span className="text-alert">{money(fine.remaining)} still owed</span>
                  ) : (
                    <span className="text-accent">cleared</span>
                  )}
                  {fine.issuedBy ? ` · issued by ${fine.issuedBy}` : ''}
                </p>

                {fine.reason && (
                  <p className="mt-1 break-words text-xs leading-5 text-muted">{fine.reason}</p>
                )}

                {fine.voided && (
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-muted">
                    Voided — not owed
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
