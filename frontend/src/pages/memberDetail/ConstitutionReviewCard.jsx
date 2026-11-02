import { shortDate } from '../../utils/format';

export default function ConstitutionReviewCard({ approvedPct, constitution, constitutionDecided, constitutionTotal, rejectedPct }) {
  return (
    <section className="rounded-xl border border-rule bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Constitution review
        </h2>
        <p className="amount text-xs text-muted">
          {constitutionDecided} of {constitutionTotal} chapters decided
        </p>
      </div>

      {constitutionTotal > 0 && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-canvas">
          <div className="flex h-full w-full">
            <span className="h-full bg-accent" style={{ width: `${approvedPct}%` }} />
            <span className="h-full bg-alert" style={{ width: `${rejectedPct}%` }} />
          </div>
        </div>
      )}

      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className="font-semibold text-accent">
          {constitution.approved} approved
        </span>
        <span className="font-semibold text-alert">
          {constitution.rejected} rejected
        </span>
        <span className="text-muted">{constitution.pending} pending</span>
      </p>

      {constitution.decisions.length === 0 ? (
        <p className="mt-3 text-xs text-muted">
          No chapter decided yet. He records his decisions from the constitution
          page on his own phone.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-rule border-t border-rule">
          {constitution.decisions.map((d) => (
            <li
              key={d.chapterNumber}
              className="flex items-start justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm leading-5">
                  <span className="amount font-semibold">
                    {String(d.chapterNumber).padStart(2, '0')}
                  </span>{' '}
                  <span className="break-words">{d.chapterTitle}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">{shortDate(d.decidedAt)}</p>
                {d.reason && (
                  <p className="mt-1 break-words text-xs leading-5 text-muted">
                    “{d.reason}”
                  </p>
                )}
              </div>

              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                  d.decision === 'approved'
                    ? 'bg-accent/15 text-accent'
                    : 'bg-alert/10 text-alert'
                }`}
              >
                {d.decision === 'approved' ? 'Approved' : 'Rejected'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
