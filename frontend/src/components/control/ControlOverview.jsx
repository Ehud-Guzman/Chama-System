import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import { money, shortDateTime } from '../../utils/format';
import { timeAgo, uptimeText } from '../../utils/timeAgo';
import { Panel, Pill, buttonClass } from './controlUi';

// The first thing on the Control Room: is the system healthy, what needs the super admin's eyes,
// and where do the group's figures stand. Every number here is read by the server in one call
// (controllers/controlRoomController) — and a part that could not be read says so instead of
// showing a blank that looks like "all clear".

const SEVERITY = {
  high: { tone: 'bad', label: 'Act' },
  medium: { tone: 'warn', label: 'Look' },
  info: { tone: 'quiet', label: 'Note' },
};

// An attention item points either at a section of this page ("accounts") or at another screen
// ("/admin/audit"). Same chip either way, so the list reads as one list.
function Jump({ to }) {
  if (!to) return null;
  const cls =
    'flex min-h-11 min-w-11 shrink-0 items-center justify-center self-start rounded-lg sm:self-center border border-rule px-3 text-xs font-semibold text-primary';
  return to.startsWith('/') ? (
    <Link to={to} className={cls}>
      Open
    </Link>
  ) : (
    <a href={`#${to}`} className={cls}>
      Go
    </a>
  );
}

function Unreadable({ part }) {
  return (
    <p className="rounded-lg border border-dashed border-alert/40 px-3 py-2 text-sm text-alert">
      {part.error}
    </p>
  );
}

// A figure tile sized for this screen: the shared StatTile's large numerals wrap "Ksh 50,000" onto
// two lines in the narrow columns here, which reads as two numbers.
function Figure({ label, value, hint, accent }) {
  return (
    <div className="min-w-0 rounded-xl border border-rule bg-surface p-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className={`amount mt-1 whitespace-nowrap text-xl font-bold ${accent ? 'text-primary' : ''}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs leading-4 text-muted">{hint}</p>}
    </div>
  );
}

function HealthRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-rule py-2.5 last:border-b-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

export default function ControlOverview({ overview, reload }) {
  const toast = useToast();
  const [verifying, setVerifying] = useState(false);
  const [chainResult, setChainResult] = useState(null);

  async function verifyChain() {
    setVerifying(true);
    try {
      const res = await api.post('/api/superadmin/audit-chain/verify', {});
      setChainResult(res.data);
      reload();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setVerifying(false);
    }
  }

  const { health, attention, glance, audit, serverErrors } = overview;

  return (
    <div className="space-y-4">
      <Panel
        id="overview"
        title="Needs your attention"
        intro={
          attention.length === 0
            ? undefined
            : 'Worst first. Each one says what it is and where to deal with it.'
        }
      >
        {attention.length === 0 ? (
          <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
            Nothing needs you. The backups are fresh, the trail verifies, nobody is locked out and no
            fund is overdrawn.
          </p>
        ) : (
          <ul className="divide-y divide-rule rounded-lg border border-rule">
            {attention.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Pill tone={SEVERITY[item.severity].tone}>{SEVERITY[item.severity].label}</Pill>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted">{item.detail}</p>
                  </div>
                </div>
                <Jump to={item.link} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel title="System health">
          {health.error ? (
            <Unreadable part={health} />
          ) : (
            <dl>
              <HealthRow label="Server">
                up {uptimeText(health.api.uptimeSeconds)} · Node {health.api.node.replace('v', '')} ·{' '}
                {health.api.environment}
              </HealthRow>
              <HealthRow label="Database">
                {health.database.connected ? (
                  <Pill tone="good">Connected</Pill>
                ) : (
                  <Pill tone="bad">Not connected</Pill>
                )}
              </HealthRow>
              <HealthRow label="Email">
                {health.mail.configured ? <Pill tone="good">Set up</Pill> : <Pill tone="warn">Not set up</Pill>}
              </HealthRow>
              <HealthRow label="Photos and logo">
                {health.photos.configured ? <Pill tone="good">Set up</Pill> : <Pill tone="warn">Not set up</Pill>}
              </HealthRow>
              <HealthRow label="Last copy downloaded">
                {health.backup.never ? (
                  <Pill tone="bad">Never</Pill>
                ) : (
                  <>
                    {timeAgo(health.backup.lastDownload?.at)}
                    {health.backup.stale && <Pill tone="warn">Old</Pill>}
                  </>
                )}
              </HealthRow>
              <HealthRow label="Off-server copy">
                {!health.backup.offsite?.enabled ? (
                  <Pill tone="warn">Not set up</Pill>
                ) : health.backup.offsite.lastTry && !health.backup.offsite.lastTry.ok ? (
                  <Pill tone="bad">Last try failed</Pill>
                ) : health.backup.offsite.lastGoodAt ? (
                  <>Kept {timeAgo(health.backup.offsite.lastGoodAt)}</>
                ) : (
                  <span className="text-muted">Not made yet</span>
                )}
              </HealthRow>
              <HealthRow label="On the server">
                {health.backup.onHost.count === 0
                  ? 'No files'
                  : `${health.backup.onHost.count} file${health.backup.onHost.count === 1 ? '' : 's'}, newest ${timeAgo(
                      health.backup.onHost.newest?.at
                    )}`}
              </HealthRow>
              <HealthRow label="Audit trail">
                {health.auditChain ? (
                  <>
                    {health.auditChain.ok ? <Pill tone="good">Verified</Pill> : <Pill tone="bad">Broken</Pill>}{' '}
                    <span className="text-muted">{timeAgo(health.auditChain.checkedAt)}</span>
                  </>
                ) : (
                  <span className="text-muted">Not checked yet</span>
                )}
              </HealthRow>
            </dl>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={verifyChain} disabled={verifying} className={buttonClass}>
              {verifying ? 'Checking every entry…' : 'Check the audit trail now'}
            </button>
            {chainResult && (
              <p
                role="status"
                className={`min-w-0 flex-1 text-xs leading-5 ${chainResult.ok ? 'text-primary' : 'text-alert'}`}
              >
                {chainResult.ok
                  ? `All ${chainResult.checked} chained entries verify. Head ${String(chainResult.head || '').slice(0, 12)}… — write it down or keep the email.`
                  : chainResult.break.message}
              </p>
            )}
          </div>
        </Panel>

        <Panel title="This week in the audit trail">
          {audit.error ? (
            <Unreadable part={audit} />
          ) : (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-rule px-2 py-3">
                <p className="amount text-2xl font-bold">{audit.entries}</p>
                <p className="text-xs text-muted">entries</p>
              </div>
              <div className="rounded-lg border border-rule px-2 py-3">
                <p className={`amount text-2xl font-bold ${audit.unusual ? 'text-accent' : ''}`}>{audit.unusual}</p>
                <p className="text-xs text-muted">unusual</p>
              </div>
              <div className="rounded-lg border border-rule px-2 py-3">
                <p className={`amount text-2xl font-bold ${audit.serious ? 'text-alert' : ''}`}>{audit.serious}</p>
                <p className="text-xs text-muted">serious</p>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs leading-5 text-muted">
            {audit.flaggedForReview
              ? `${audit.flaggedForReview} flagged for your review. `
              : ''}
            {audit.failedSignIns || audit.failedLookups
              ? `In the last day: ${audit.failedSignIns || 0} failed sign-in${audit.failedSignIns === 1 ? '' : 's'}, ${
                  audit.failedLookups || 0
                } failed passbook ${audit.failedLookups === 1 ? 'try' : 'tries'}. `
              : ''}
            <Link to="/admin/audit" className="font-semibold text-primary">
              Open the audit trail
            </Link>{' '}
            (the officers&apos; table and failed sign-ins are at the top).
          </p>

          <h3 className="mt-5 text-xs font-semibold uppercase tracking-widest text-muted">Scheduled jobs</h3>
          {health.error ? null : (
            <ul className="mt-2 divide-y divide-rule rounded-lg border border-rule">
              {health.jobs.list.map((job) => (
                <li key={job.name} className="px-3 py-2.5 text-sm">
                  <p className="font-medium">{job.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {job.paused ? (
                    <Pill tone="warn">Paused</Pill>
                  ) : job.lastRun ? (
                    job.lastRun.ok ? (
                      <Pill tone="good">Ran {timeAgo(job.lastRun.startedAt)}</Pill>
                    ) : (
                      <Pill tone="bad">Failed {timeAgo(job.lastRun.startedAt)}</Pill>
                    )
                  ) : (
                    <Pill tone="quiet">Not run yet</Pill>
                  )}
                  <span className="text-xs text-muted">next in {job.nextRunIn || '—'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        id="errors"
        title="Server errors"
        intro="When the server itself fails (not a mistyped form: a fault). Each distinct error is emailed to you once, then counted here."
      >
        {!serverErrors || serverErrors.error ? (
          <Unreadable part={serverErrors || { error: 'Server errors could not be read.' }} />
        ) : serverErrors.distinct === 0 ? (
          <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">
            No server errors in the last {serverErrors.days} days.
          </p>
        ) : (
          <ul className="divide-y divide-rule rounded-lg border border-rule">
            {serverErrors.recent.map((item) => (
              <li key={item.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="min-w-0 flex-1 text-sm font-semibold">{item.message}</p>
                  <Pill tone="bad">{item.count}×</Pill>
                </div>
                <p className="mt-0.5 break-all text-xs leading-5 text-muted">
                  {item.kind === 'request' ? `${item.method} ${item.route}` : item.kind.replace('_', ' ')} · last{' '}
                  {timeAgo(item.lastAt)}
                  {item.requestId ? ` · request ${item.requestId}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="The group at a glance" intro="Read straight off the books, with no role filters.">
        {glance.error ? (
          <Unreadable part={glance} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <Figure label="Active members" value={glance.members.active} hint={`${glance.members.inactive} resigned or inactive`} />
              <Figure label="Money held" value={money(glance.money.netBalance)} accent hint="after spending" />
              <Figure label="Collected, all time" value={money(glance.money.totalContributed)} />
              <Figure
                label="Fines owed"
                value={money(glance.fines.owedTotal)}
                hint={`${glance.fines.owedCount} fine${glance.fines.owedCount === 1 ? '' : 's'}`}
              />
            </div>
            {glance.funds.length > 0 && (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {glance.funds.map((fund) => (
                  <li
                    key={fund.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-rule px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate" title={fund.name}>
                      {fund.name}
                      {fund.isRecoverable && <span className="ml-1 text-xs text-muted">(loans)</span>}
                    </span>
                    <span className={`amount shrink-0 whitespace-nowrap font-semibold ${fund.balance < 0 ? 'text-alert' : ''}`}>
                      {money(fund.balance)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="mt-3 text-xs text-muted">Read {shortDateTime(overview.generatedAt)}.</p>
      </Panel>
    </div>
  );
}
