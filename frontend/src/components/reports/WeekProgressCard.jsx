import { money, shortDate } from '../../utils/format';

// Where this week stands, at a glance.
//
// This is the card the summary opens with, and it exists because the thing it replaced — a twelve-
// week bar chart — could not be read: every active member pays the same weekly amount, so every bar
// came out the same height and there was nothing to see. The question the office actually has on a
// collection day is not "what have the last twelve weeks looked like", it is:
//
//   how much of this week is in, and who is still to bring theirs?
//
// So: one week, one bar, two numbers and a count of members. Everything on it is a figure the office
// can act on today — the gap is what is still to be collected and the counts say how many people that
// is. It is right by construction rather than by estimate: `week.paid` is the weekly contributions
// dated inside the week, `week.expected` is the weekly amount times the active roster, and the rest
// is arithmetic over the two (backend/src/utils/weekProgress, where the rule is tested).
//
// The wording is deliberate. "Brought the whole 1,400" is what the office would say out loud, and
// "still to come" is the money the week is short of — never "arrears", which is a different figure
// (closed weeks) and belongs to the weekly reconciliation, where the weeks that closed short are
// named.
export default function WeekProgressCard({ week, className = '' }) {
  const {
    weekNumber,
    startDate,
    endDate,
    weeklyAmount = 0,
    members = 0,
    expected = 0,
    paid = 0,
    shortfall = 0,
    paidCount = 0,
    partialCount = 0,
    noneCount = 0,
    percent = 0,
    settled = false,
  } = week || {};

  return (
    <section className={`rounded-xl border border-rule bg-surface p-4 ${className}`.trim()}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
          This week — week {weekNumber}
        </h2>
        {/* The week runs Friday to Thursday, and the Thursday is the day it is collected on: the
            date the office is working towards, not just a label. */}
        <p className="amount text-xs text-muted">
          {shortDate(startDate)} → {shortDate(endDate)}
        </p>
      </div>

      <p className="amount mt-2 text-2xl font-bold">
        {money(paid)}
        <span className="text-base font-medium text-muted"> of {money(expected)}</span>
        {settled && <span className="ml-2 align-middle text-sm font-semibold text-accent">· in full</span>}
      </p>

      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-canvas" aria-hidden="true">
        <span
          className={`block h-full rounded-full ${settled ? 'bg-accent' : 'bg-primary'}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* The count is the actionable half: a gap of 16,800 is a number, "ten members still to pay"
          is a list of phone calls. */}
      <p className="mt-2 text-sm">
        <span className="amount font-semibold">
          {paidCount} of {members}
        </span>{' '}
        members have brought the whole {money(weeklyAmount)}
        {partialCount > 0 && (
          <>
            {' '}
            · <span className="amount font-semibold">{partialCount}</span> part-paid
          </>
        )}
        {noneCount > 0 && (
          <>
            {' '}
            · <span className="amount font-semibold">{noneCount}</span> still to pay
          </>
        )}
      </p>

      {shortfall > 0 ? (
        <p className="amount mt-1 text-sm font-semibold text-alert">
          {money(shortfall)} still to come this week
        </p>
      ) : (
        <p className="mt-1 text-sm font-semibold text-accent">
          {members > 0 && paidCount === members
            ? 'Every member has paid — nothing left to collect.'
            : 'The week is collected — nothing left to collect.'}
        </p>
      )}

      {/* The arithmetic, in words, on the card itself: a figure somebody acts on has to be one they
          can check against what they know. */}
      <p className="mt-2 text-[11px] leading-5 text-muted">
        The week asks {money(weeklyAmount)} from each of the {members} active members ({money(weeklyAmount)} ×{' '}
        {members} = {money(expected)}). What has come in is counted from the weekly contributions dated
        inside the week — tea and the other funds are collected alongside it, not instead of it.
      </p>
    </section>
  );
}
