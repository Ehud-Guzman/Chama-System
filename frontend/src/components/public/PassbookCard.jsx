import { useMemo, useRef, useState } from 'react';
import api from '../../services/api';
import { useToast } from '../shared/Toast';
import { money, shortDate, METHOD_LABELS } from '../../utils/format';
import { blobErrorMessage } from '../../utils/blobError';
import MemberAvatar from '../members/MemberAvatar';
import FinesPanel from '../shared/FinesPanel';
import WeeklyScheduleTable from '../shared/WeeklyScheduleTable';

const PAGE_SIZE = 20;

// One member's full public passbook: header, pledged-vs-contributed by type,
// the ledger, and a stamped total. It is the one public view of a member there
// is, and it is only ever reached by typing that member's own registered phone
// number — pass a fresh `key` from the caller when the underlying member changes
// so the reveal animation replays.
// `statementUrl` (relative, e.g. /api/public/lookup/statement?phone=...) and
// `statementExcelUrl` (e.g. /api/public/lookup/statement/excel?phone=...) are
// both optional — omit them if the caller has no way to re-identify this member.
// They are independent URLs, not derived from one another — always pass both
// explicitly from the caller.
export default function PassbookCard({
  result,
  statementUrl,
  statementExcelUrl,
}) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  // Animates once on mount only — paging away and back doesn't replay it
  const animateRef = useRef(true);

  // Newest entries first; runningBalance was computed chronologically server-side
  const rows = useMemo(() => [...result.contributions].reverse(), [result]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const animate = animateRef.current && page === 1;

  // Fetched as a blob rather than a plain <a href> — a bare link hitting a
  // rate limit or error shows the visitor raw JSON in their browser instead
  // of the app's own error handling.
  async function exportStatement() {
    setExporting(true);
    try {
      const res = await api.get(statementUrl, { responseType: 'blob' });
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
      const res = await api.get(statementExcelUrl, { responseType: 'blob' });
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
      <section className="overflow-hidden rounded-xl border border-rule bg-surface shadow-sm">
        {/* Passbook header */}
        <header className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <MemberAvatar name={result.name} photoUrl={result.photoUrl} />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold">{result.name}</h2>
              {result.regNumber && (
                <p className="amount mt-0.5 text-xs font-medium uppercase tracking-widest text-muted">
                  Member № {result.regNumber}
                </p>
              )}
            </div>
          </div>
          {(statementUrl || statementExcelUrl) && (
            <div className="flex shrink-0 gap-2">
              {statementUrl && (
                <button
                  type="button"
                  onClick={exportStatement}
                  disabled={exporting}
                  className="rounded-lg border border-rule px-3 py-2 text-xs font-medium text-primary disabled:opacity-60"
                >
                  {exporting ? 'Exporting…' : 'PDF'}
                </button>
              )}

              {statementExcelUrl && (
                <button
                  type="button"
                  onClick={exportStatementExcel}
                  disabled={exporting}
                  className="rounded-lg border border-rule px-3 py-2 text-xs font-medium text-primary disabled:opacity-60"
                >
                  {exporting ? 'Exporting…' : 'Excel'}
                </button>
              )}
            </div>
          )}
        </header>

        {/* Everything about this member at a glance: who they are (masked
            phone, member since) and the numbers behind the ledger —
            contributions logged, what they pledged, fines owed and cleared. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-rule px-5 py-4 md:grid-cols-3">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Phone
            </dt>
            <dd className="amount mt-0.5 text-sm font-medium">{result.phoneMasked || '—'}</dd>
          </div>

          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Member since
            </dt>
            <dd className="mt-0.5 text-sm font-medium">{shortDate(result.joinDate)}</dd>
          </div>

          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Contributions
            </dt>
            <dd className="amount mt-0.5 text-sm font-medium">
              {result.contributionsCount || 0} recorded
            </dd>
          </div>

          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Pledged
            </dt>
            <dd className="amount mt-0.5 text-sm font-medium">{money(result.totalPledged)}</dd>
          </div>

          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Outstanding fines
            </dt>
            <dd
              className={`amount mt-0.5 text-sm font-medium ${
                result.fines?.totalOwed > 0 ? 'text-alert' : ''
              }`}
            >
              {money(result.fines?.totalOwed || 0)}
            </dd>
          </div>

          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Fines settled
            </dt>
            <dd className="amount mt-0.5 text-sm font-medium">
              {result.finesSettledCount || 0} cleared
            </dd>
          </div>
        </dl>

        {/* Member detail strip. Email, next of kin and the reminder flag arrive
            only when the caller proved their own number at the gate — the server
            omits them entirely otherwise, so this strip is empty for anyone who
            somehow reached a passbook that is not theirs. The phone number is
            never sent here at all, only the masked form. */}
        <div className="border-b border-rule px-5 py-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {result.email && (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Email
                </dt>
                <dd className="truncate mt-0.5 font-medium text-ink/80">
                  {result.email}
                </dd>
              </div>
            )}
            {result.nextOfKin?.name && (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Next of kin
                </dt>
                <dd className="mt-0.5 text-muted">
                  {result.nextOfKin.name}
                  {result.nextOfKin.relationship ? ` · ${result.nextOfKin.relationship}` : ''}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Notifications
              </dt>
              <dd className="mt-0.5">
                {result.emailNotifications === false ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-rule px-2 py-0.5 text-xs text-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                    off
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink">
                    <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                    on
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        {/* Open book: pledged vs. contributed per type, shown whether or not
            there are contributions yet */}
        {result.byType?.length > 0 && (
          <div className="border-b border-rule px-5 py-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
              By contribution type
            </p>
            <ul className="space-y-2">
              {result.byType.map((b) => (
                <li key={b.type} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{b.type}</span>
                  <span className="amount shrink-0 font-medium">
                    {money(b.contributed)}
                    {b.pledged > 0 && <span className="text-muted"> / {money(b.pledged)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">No contributions recorded yet.</p>
        ) : (
          <>
            {/* Column eyebrows. The right-hand column is cash logged against
                this member — cumulative, not a balance: what he actually holds
                is the stamped total below. */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
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
                  <span>
                    <span className="block text-sm font-medium">{shortDate(c.date)}</span>
                    <span className="block text-xs text-muted">
                      {c.type ? `${c.type} · ` : ''}
                      {METHOD_LABELS[c.method] || c.method}
                    </span>
                    {c.fineDeducted > 0 && (
                      <span className="block text-xs text-alert">
                        − {money(c.fineDeducted)} to fines (paid {money(c.grossAmount)})
                      </span>
                    )}
                    {c.isGroupFund && (
                      <span className="block text-xs text-muted">
                        Group fund — not counted in your personal balance
                      </span>
                    )}
                  </span>
                  <span className="amount text-right text-sm font-semibold">{money(c.amount)}</span>
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

        {/* Stamped total — what he holds now, from the cycle engine, so the
            passbook can never say 0 while the office sees money against him. */}
        <footer
          className={`border-t-2 border-primary/20 bg-primary/5 px-5 py-5 ${
            animate ? 'total-stamp' : ''
          }`}
          style={
            animate ? { animationDelay: `${Math.min(pageRows.length, 20) * 40 + 120}ms` } : undefined
          }
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            {result.ledger ? `Held by member · week ${result.ledger.currentWeek}` : 'Held by member'}
          </p>
          <p className="amount mt-1 text-3xl font-bold text-primary">
            {money(result.ledger ? result.ledger.money : result.totalContributed)}
          </p>
          {result.ledger && (
            <p className="amount mt-1 text-sm text-muted">
              {money(result.ledger.openingBalance)} brought forward + {money(result.ledger.paid)}{' '}
              paid since week {result.ledger.cycleStartWeek} − {money(result.ledger.required)}{' '}
              required − {money(result.ledger.tea)} tea
            </p>
          )}
          {(result.ledger ? result.ledger.arrears > 0 : false) && (
            <p className="amount mt-1 text-sm font-medium text-alert">
              {money(result.ledger.arrears)} behind
              {result.ledger.weeksBehind > 0
                ? ` · ${result.ledger.weeksBehind} week${result.ledger.weeksBehind === 1 ? '' : 's'}`
                : ''}
            </p>
          )}
          {result.totalPledged > 0 && (
            <p className="amount mt-1 text-sm text-muted">of {money(result.totalPledged)} pledged</p>
          )}
        </footer>
      </section>

      <FinesPanel fines={result.fines} />
      <WeeklyScheduleTable schedules={result.weeklySchedules} />
    </div>
  );
}
