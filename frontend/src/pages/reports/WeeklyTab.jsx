import { shortDate, money } from '../../utils/format';
import Loader from '../../components/shared/Loader';

export default function WeeklyTab({ backupHealth, openWeek, setOpenWeek, weeks }) {
  return (
    <section>
      {!weeks ? (
        <Loader />
      ) : weeks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-rule px-5 py-8 text-center text-sm text-muted">
          No weekly contribution types set up yet.
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">
            Expected vs actual, per week, across every fixed weekly
            contribution type, with the members&rsquo; own contributions named
            on every week. The totals rarely match exactly on their own
            — one member overpaying offsets another falling short — so a
            week is only flagged{" "}
            <span className="font-semibold text-alert">short</span> once it
            has closed and one or more eligible members still owe their
            weekly minimum. The week running now reads{" "}
            <span className="font-semibold">in progress</span> with what has
            come in so far, because nobody can be behind on a collection
            night that has not happened yet. Tap a week to see exactly who.
          </p>
          {/* The week's figures, and one fact about the books that is not a figure: how long
              ago somebody last took a copy off this machine. The committee reads this screen
              every week, which makes it the right place for a nag nobody has to remember —
              and it renders only when the backend says there is something to say, so a group
              that downloads regularly never sees it. */}
          {backupHealth?.note && (
            <p className="mb-3 rounded-xl border border-alert/40 bg-alert/5 px-4 py-3 text-xs font-medium leading-5 text-alert">
              <span className="font-semibold">Backup: </span>
              {backupHealth.note}
            </p>
          )}
          <ul className="overflow-hidden rounded-xl border border-rule bg-surface">
            {weeks.map((w) => (
              <li
                key={w.weekNumber}
                className="border-b border-rule last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenWeek(
                      openWeek === w.weekNumber ? null : w.weekNumber,
                    )
                  }
                  className="flex w-full flex-col gap-1 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="amount text-sm font-semibold">
                      Week {w.weekNumber}
                    </span>
                    {w.isCurrent && (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                        Now
                      </span>
                    )}
                    {w.isBaseline && (
                      <span className="rounded bg-canvas px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        Baseline
                      </span>
                    )}
                    <span className="amount text-xs text-muted">
                      {shortDate(w.startDate)} – {shortDate(w.endDate)}
                    </span>

                    {/* What the members themselves paid in this week — the
                        figure the week is judged on, kept apart from the tea
                        every member is charged automatically. */}
                    <span className="amount w-full text-xs text-muted sm:w-auto">
                      Paid in by members {money(w.memberTotal)}
                      {!w.isBaseline && w.memberEligibleCount > 0 && (
                        <span>
                          {" "}
                          ({w.memberPaidCount} of {w.memberEligibleCount} paid in full)
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span
                      className={`text-xs font-semibold ${
                        w.isCurrent
                          ? "text-muted"
                          : w.balanced
                            ? "text-accent"
                            : "text-alert"
                      }`}
                    >
                      {/* The week running now is never "short": its Thursday
                          is still to come. Calling it short on its own
                          Friday made every week read like a failure the
                          moment it opened — what belongs there is what has
                          come in so far, which the figures beside this
                          already state. */}
                      {w.isBaseline
                        ? "Nothing due"
                        : w.isCurrent
                          ? "In progress"
                          : w.balanced
                            ? "All paid"
                            : `${w.shortfallCount} short`}
                    </span>
                    <span className="amount text-sm font-semibold">
                      {money(w.actualTotal)}
                    </span>
                    <span className="amount text-xs text-muted">
                      / {money(w.expectedTotal)}
                    </span>
                  </span>
                </button>

                {openWeek === w.weekNumber && (
                  <div className="border-t border-rule bg-canvas/40 px-4 py-3">
                    <div className="space-y-3">
                      {w.types.map((t) => (
                        <div key={t.typeId}>
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-sm font-semibold">
                              {t.typeName}
                              {t.isGroupFund && (
                                <span className="ml-1 text-[11px] font-normal uppercase tracking-wide text-muted">
                                  group fund
                                </span>
                              )}
                            </p>
                            <p
                              className={`amount text-sm font-semibold ${
                                t.diff === 0 ? "text-accent" : "text-alert"
                              }`}
                            >
                              {money(t.actual)} / {money(t.expected)}
                              {t.diff !== 0 && (
                                <span className="ml-1 text-xs">
                                  ({t.diff > 0 ? "+" : ""}
                                  {money(t.diff)})
                                </span>
                              )}
                            </p>
                          </div>
                          {t.untrackedAmount > 0 && (
                            <p className="amount mt-0.5 text-xs text-muted">
                              + {money(t.untrackedAmount)} logged against
                              ineligible/system members (e.g. backdated
                              opening balances)
                            </p>
                          )}
                          {/* Contributors first. This list used to sit at the
                              bottom of the block, behind a click, under a roster
                              of everybody who had NOT paid — so the one question
                              the treasurer is holding the page open to answer
                              ("did he pay?") took the longest to reach. It is now
                              the first list, open by default, and still a
                              <details> so a week where everybody paid can be
                              folded away. Guarded, because an API deployed before
                              this field existed simply has no list. */}
                          {t.paidMembers?.length > 0 && (
                            <details className="mt-1" open>
                              <summary className="cursor-pointer text-xs font-medium text-primary">
                                Who paid in full ({t.paidMembers.length})
                              </summary>
                              <ul className="mt-1 space-y-0.5">
                                {t.paidMembers.map((m) => (
                                  <li
                                    key={m.memberId}
                                    className="flex items-center justify-between text-xs"
                                  >
                                    <span className="text-muted">
                                      {m.name}
                                      {m.regNumber && (
                                        <span className="amount ml-1 text-muted">
                                          ({m.regNumber})
                                        </span>
                                      )}
                                    </span>
                                    <span className="amount font-medium text-accent">
                                      {money(m.paid)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                          {/* Then who still owes. It needs its own heading now that
                              it follows the payers: without one it reads as a
                              continuation of the list above it, which is the
                              opposite of what it says. */}
                          {t.shortfallMembers.length > 0 ? (
                            <>
                              <p className="mt-2 text-xs font-medium text-alert">
                                Still to pay ({t.shortfallMembers.length})
                              </p>
                              <ul className="mt-1 space-y-0.5">
                                {t.shortfallMembers.map((m) => (
                                  <li
                                    key={m.memberId}
                                    className="flex items-center justify-between text-xs"
                                  >
                                    <span className="text-muted">
                                      {m.name}
                                      {m.regNumber && (
                                        <span className="amount ml-1 text-muted">
                                          ({m.regNumber})
                                        </span>
                                      )}
                                    </span>
                                    <span
                                      className={`amount font-medium ${
                                        m.status === "unpaid"
                                          ? "text-alert"
                                          : "text-primary"
                                      }`}
                                    >
                                      {money(m.paid)} ·{" "}
                                      {m.status === "partial" ? "partly paid" : "nothing paid"}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : t.paidMembers?.length ? null : (
                            // Only when there is nothing else to show: with the
                            // payers listed above it, this sentence said the same
                            // thing twice.
                            <p className="mt-1 text-xs text-muted">
                              Every eligible member paid in full this week.
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
