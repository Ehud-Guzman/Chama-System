import { useMemo, useRef, useState } from 'react';
import api from '../../services/api';
import { useToast } from '../shared/Toast';
import { money, shortDate, METHOD_LABELS } from '../../utils/format';
import { blobErrorMessage } from '../../utils/blobError';
import { passbookPosition } from '../../utils/passbookPosition';
import MemberAvatar from '../members/MemberAvatar';
import FinesPanel from '../shared/FinesPanel';
import WeeklyScheduleTable from '../shared/WeeklyScheduleTable';
import StatementPeriodPicker, { useStatementPeriod } from '../shared/StatementPeriodPicker';

const PAGE_SIZE = 20;

// One member's full public passbook, laid out as a dashboard.
//
// Only ever reached by typing the ID recorded for that member; pass a fresh `key` from the caller
// when the underlying member changes so the reveal animation replays.
//
// Three bands, in the order the questions get asked:
//
//   1. WHO — the identity band, full width: the name, the member number, the date he joined.
//   2. WHERE HE STANDS — the position card (what he holds, the sum behind that figure, and what he
//      owes), then his details and his statement downloads. On a phone this comes first under his
//      name, because "how much do I have, and am I behind?" is the whole reason most members open
//      this page. On a wide screen it becomes the right-hand rail, *beside* the ledger rather than
//      above it — which is what puts the rows themselves on the first screen instead of 400px down.
//   3. WHAT HAPPENED — the ledger, the fines and the week-by-week schedule: the detail behind the
//      position card. On a wide screen this is the main column, twice the width of the rail, because
//      a ledger is the one thing here that wants horizontal room.
//
// The three used to be a single column of equally-weighted blocks with the at-a-glance facts above
// the ledger, so on a laptop the actual record began below the fold and the biggest figure on the
// page competed with four identical cards for attention.
//
// `statementUrl` (relative, e.g. /api/public/lookup/statement?nationalId=...) and `statementExcelUrl`
// (e.g. /api/public/lookup/statement/excel?nationalId=...) are both optional — omit them if the
// caller has no way to re-identify this member. They are independent URLs, not derived from one
// another — always pass both explicitly from the caller.
//
// The period picker sits with those two buttons rather than with the ledger, so the member's own
// statement and the office's copy take their period from the same control and the same wording.
export default function PassbookCard({ result, statementUrl, statementExcelUrl }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const period = useStatementPeriod();
  // Animates once on mount only — paging away and back doesn't replay it
  const animateRef = useRef(true);

  // Newest entries first; runningBalance was computed chronologically server-side
  const rows = useMemo(() => [...result.contributions].reverse(), [result]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const animate = animateRef.current && page === 1;

  // What he holds and whether he is behind. The wording — including the difference between "money
  // held" and "paid in his own name" when the cycle engine has no answer — lives in
  // utils/passbookPosition, where it is tested without a browser.
  const position = passbookPosition(result.ledger, result.totalContributed);

  // Fetched as a blob rather than a plain <a href> — a bare link hitting a
  // rate limit or error shows the visitor raw JSON in their browser instead
  // of the app's own error handling.
  async function exportStatement() {
    setExporting(true);
    try {
      const res = await api.get(`${statementUrl}${period.query}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${result.regNumber || result.name}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(await blobErrorMessage(err, 'Could not export the statement. Please try again.'), 'error');
    } finally {
      setExporting(false);
    }
  }

  async function exportStatementExcel() {
    setExporting(true);
    try {
      const res = await api.get(`${statementExcelUrl}${period.query}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${result.regNumber || result.name}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(
        await blobErrorMessage(err, 'Could not export the Excel statement. Please try again.'),
        'error'
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* =====================================================
          WHO — the identity band, above both columns.

          It carries who this is and nothing else, so the rest of the page
          has a subject before it has figures. The two download buttons used
          to sit at this band's right-hand end, which squeezed the name into a
          corner on a phone; they belong with the period they download, and
          they live in the rail now.
      ====================================================== */}
      <section className="flex items-center gap-3 rounded-2xl border border-rule bg-surface px-5 py-4 shadow-sm">
        <MemberAvatar name={result.name} photoUrl={result.photoUrl} />

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold">{result.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
            {result.regNumber && (
              <span className="amount font-medium uppercase tracking-widest">
                Member № {result.regNumber}
              </span>
            )}
            <span>Member since {shortDate(result.joinDate)}</span>
          </p>
        </div>
      </section>

      {/* Two columns from xl, one on a phone. The rail is first in the DOM so a phone reads the
          position card before the ledger — the order the questions get asked — and the explicit
          column starts put it on the right once there is room. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start xl:gap-6">
        <aside className="min-w-0 space-y-4 xl:col-start-2 xl:row-start-1">
          {/* ===================================================
              WHERE HE STANDS — the figure the page exists for.

              This was the stamped footer at the foot of the ledger. It moved
              to the top of the reading order because it is the question, not
              the answer: the rows below are the evidence. The stamp's own
              animation came with it, so the figure still lands after the rows
              it belongs to have drawn.
          ==================================================== */}
          <section
            className={`rounded-xl border border-rule bg-primary/5 px-5 py-4 shadow-sm ${
              animate ? 'total-stamp' : ''
            }`}
            style={animate ? { animationDelay: '320ms' } : undefined}
          >
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              {position.label}
            </p>
            <p className="amount mt-1 text-3xl font-bold text-primary">{money(position.held)}</p>

            {position.identity && (
              <p className="amount mt-1 text-xs leading-5 text-muted">{position.identity}</p>
            )}

            {position.arrearsText ? (
              <p className="amount mt-2 text-sm font-medium text-alert">{position.arrearsText}</p>
            ) : position.aheadText ? (
              /* Above the group's line: it asks nothing of him, so the card says so in the calm
                 tone rather than in the red one used for money the group is chasing. */
              <p className="amount mt-2 text-sm font-medium text-muted">{position.aheadText}</p>
            ) : position.upToDate ? (
              /* Said out loud rather than left blank: a member who is up to date should not have to
                 work it out from an absence. */
              <p className="mt-2 text-sm font-medium text-primary">
                Up to date — nothing owing in arrears.
              </p>
            ) : null}
          </section>

          {/* ===================================================
              His details — and, when the caller proved his own number at the
              gate, his email and his next of kin. The server omits those for
              anybody else, so this same card is simply shorter on a passbook
              that is not his. The phone number is never sent here at all,
              only the masked form.
          ==================================================== */}
          <section className="rounded-xl border border-rule bg-surface px-5 py-4 shadow-sm">
            <h3 className="text-sm font-bold">Your details</h3>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              {/* What he brought forward leads: it is the figure his money is built on, and the one
                  the treasurer verified when the books opened. */}
              {result.ledger && (
                <Fact
                  label={`Carried in (week ${result.ledger.cycleStartWeek})`}
                  value={money(result.ledger.openingBalance)}
                  hint="(what he held when these books opened)"
                />
              )}

              {result.ledger && (
                <Fact
                  label="Weeks behind"
                  // The chased count, not the plain one: above the group's line nothing is being
                  // asked of him, and the card above says so — a page that said "Ahead" in one line
                  // and "1 week behind" in the next would be arguing with itself.
                  value={
                    position.chasedWeeksBehind > 0 ? position.chasedWeeksBehind : 'None'
                  }
                  alert={position.chasedWeeksBehind > 0}
                />
              )}

              <Fact label="Phone" value={result.phoneMasked || '—'} />
              <Fact
                label="Paid in his own name"
                value={money(result.totalContributed)}
                hint="(what the rows against him add up to)"
              />
              <Fact
                label="Outstanding fines"
                value={money(result.fines?.totalOwed || 0)}
                hint="(owed to the group, kept out of the figures above)"
                alert={result.fines?.totalOwed > 0}
              />
              <Fact label="Fines settled" value={`${result.finesSettledCount || 0} cleared`} />
              <Fact
                label="Notifications"
                value={
                  result.emailNotifications === false ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-rule px-2 py-0.5 text-xs font-normal text-muted">
                      <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                      off
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink">
                      <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                      on
                    </span>
                  )
                }
              />

              {result.email && (
                <div className="col-span-2">
                  <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                    Email
                  </dt>
                  <dd className="mt-0.5 truncate font-medium text-ink/80">{result.email}</dd>
                </div>
              )}
            </dl>

            {/* The next-of-kin list he gave the office — a spouse, the children, the in-laws. Given
                its own block rather than a grid cell: a family does not fit in one, and each contact
                needs its number on the same line to be useful in an emergency. */}
            {result.nextOfKin?.length > 0 && (
              <div className="mt-3 border-t border-rule pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                  Next of kin ({result.nextOfKin.length})
                </p>
                <ul className="mt-1.5 space-y-2">
                  {result.nextOfKin.map((person, index) => (
                    <li key={index} className="text-sm">
                      <span className="font-medium">{person.name}</span>
                      {person.relationship ? (
                        <span className="text-muted"> · {person.relationship}</span>
                      ) : null}
                      {person.phone && (
                        <span className="amount block text-xs text-muted">📞 {person.phone}</span>
                      )}
                      {person.email && (
                        <span className="block break-words text-xs text-muted">
                          {person.email}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* ===================================================
              His statement, as a download.

              The period picker and the two buttons belong together — both
              download whatever period is chosen, so burying the picker
              further down the page would mean printing a period nobody
              asked for. Note the buttons wrap to a row on a phone and stack
              in the rail, which is 336px wide.
          ==================================================== */}
          {(statementUrl || statementExcelUrl) && (
            <section className="rounded-xl border border-rule bg-surface px-5 py-4 shadow-sm">
              <h3 className="text-sm font-bold">Your statement</h3>
              <p className="mt-1 text-xs leading-5 text-muted">
                Choose a period, then download it — a PDF to print, or a spreadsheet to work with.
              </p>

              <StatementPeriodPicker
                className="mt-3 w-full"
                idPrefix="member-period"
                preset={period.preset}
                from={period.from}
                to={period.to}
                onChange={({ preset, from, to }) => {
                  if (preset !== undefined) period.setPreset(preset);
                  if (from !== undefined) period.setFrom(from);
                  if (to !== undefined) period.setTo(to);
                }}
              />

              <div className="mt-3 flex flex-col gap-2 sm:flex-row xl:flex-col">
                {statementUrl && (
                  <button
                    type="button"
                    onClick={exportStatement}
                    disabled={exporting}
                    aria-label={`Download ${result.name}'s statement as a PDF${
                      period.label && period.preset !== 'whole' ? ` for ${period.label}` : ''
                    }`}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-rule px-3 text-sm font-medium text-primary disabled:opacity-60"
                  >
                    {exporting ? 'Exporting…' : 'Statement PDF'}
                  </button>
                )}

                {statementExcelUrl && (
                  <button
                    type="button"
                    onClick={exportStatementExcel}
                    disabled={exporting}
                    aria-label={`Download ${result.name}'s statement as a spreadsheet`}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-rule px-3 text-sm font-medium text-primary disabled:opacity-60"
                  >
                    {exporting ? 'Exporting…' : 'Statement Excel'}
                  </button>
                )}
              </div>
            </section>
          )}
        </aside>

        {/* =====================================================
            WHAT HAPPENED — the ledger, the fines and the weeks.

            The main column of the dashboard, twice the rail's width from
            xl, because a ledger is the one thing on this page that wants
            horizontal room. Nothing about the position is repeated here:
            the rows are the evidence for the figure in the rail.
        ====================================================== */}
        <div className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1">
          <section className="overflow-hidden rounded-xl border border-rule bg-surface shadow-sm">
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-rule px-5 py-3">
              <h3 className="text-sm font-bold">Your contributions</h3>
              <p className="text-xs text-muted">
                {result.contributionsCount || 0} recorded · newest first
              </p>
            </header>

            {/* What he has paid into, by type — shown whether or not there are any contributions
                yet, because a member reading this wants to see every fund the group tracks, not
                only the ones he has touched. */}
            {result.byType?.length > 0 && (
              <div className="border-b border-rule px-5 py-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
                  Paid by contribution type
                </p>
                <ul className="space-y-2">
                  {result.byType.map((b) => (
                    <li key={b.type} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{b.type}</span>
                      <span className="amount shrink-0 font-medium">{money(b.contributed)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">
                No contributions recorded yet.
              </p>
            ) : (
              <>
                {/* Column eyebrows. The right-hand column is cash logged against
                    this member — cumulative, not a balance: what he actually holds
                    is the position card beside this ledger. */}
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
                  <span>Date · Type</span>
                  <span className="text-right">Amount</span>
                  <span className="w-24 text-right">Paid to date</span>
                </div>

                <ul>
                  {pageRows.map((c, i) => (
                    <li
                      key={`${page}-${i}`}
                      className={`grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-t border-rule px-5 py-3 ${
                        animate ? 'ledger-row-in' : ''
                      }`}
                      style={animate ? { animationDelay: `${i * 40}ms` } : undefined}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{shortDate(c.date)}</span>
                        <span className="block break-words text-xs text-muted">
                          {c.type ? `${c.type} · ` : ''}
                          {METHOD_LABELS[c.method] || c.method}
                        </span>
                        {c.fineDeducted > 0 && (
                          <span className="block break-words text-xs text-alert">
                            − {money(c.fineDeducted)} to fines (paid {money(c.grossAmount)})
                          </span>
                        )}
                        {c.isGroupFund && (
                          <span className="block text-xs text-muted">
                            Group fund — not counted in your personal balance
                          </span>
                        )}
                      </span>
                      <span className="amount text-right text-sm font-semibold">
                        {money(c.amount)}
                      </span>
                      <span className="amount w-24 text-right text-sm font-medium text-accent">
                        {money(c.runningBalance)}
                      </span>
                    </li>
                  ))}
                </ul>

                {pages > 1 && (
                  <nav
                    className="flex items-center justify-between border-t border-rule px-5 py-3"
                    aria-label="Contribution pages"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        animateRef.current = false;
                        setPage((p) => Math.max(1, p - 1));
                      }}
                      disabled={page === 1}
                      className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary disabled:opacity-40"
                    >
                      Newer
                    </button>
                    <span className="amount text-xs text-muted">
                      Page {page} of {pages}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        animateRef.current = false;
                        setPage((p) => Math.min(pages, p + 1));
                      }}
                      disabled={page === pages}
                      className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary disabled:opacity-40"
                    >
                      Older
                    </button>
                  </nav>
                )}
              </>
            )}
          </section>

          {/* Both are detail behind the position card: the fines he still owes, and the week-by-week
              schedule the figures above are counted from. */}
          <FinesPanel fines={result.fines} />
          <WeeklyScheduleTable schedules={result.weeklySchedules} />
        </div>
      </div>
    </div>
  );
}

// One label/value pair in the details card. A component rather than nine copies of the same dt/dd
// pair, so the label style and the hint line cannot drift apart between them. `alert` is for the two
// figures that are bad news when they are not zero. `value` is a node, because one of the nine is a
// badge rather than a number.
function Fact({ label, value, hint, alert }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</dt>
      <dd className={`amount mt-0.5 text-sm font-medium ${alert ? 'text-alert' : ''}`}>{value}</dd>
      {hint && <p className="mt-0.5 text-[11px] leading-4 text-muted">{hint}</p>}
    </div>
  );
}
