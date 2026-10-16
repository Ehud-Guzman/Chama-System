const mongoose = require('mongoose');
const User = require('../models/User');
const Member = require('../models/Member');
const Fine = require('../models/Fine');
const AuditLog = require('../models/AuditLog');
const AuditReview = require('../models/AuditReview');
const JobRun = require('../models/JobRun');
const SecurityEvent = require('../models/SecurityEvent');
const { getOrCreateSettings } = require('../utils/settings');
const { computeMoneyPosition } = require('../utils/moneyPosition');
const { computeBackupHealth } = require('../utils/backupHealth');
const { isMailConfigured } = require('../utils/mailer');
const { isCloudinaryConfigured } = require('../utils/cloudinary');
const { readAuditEntry } = require('../utils/auditFlags');
const { countAttention } = require('../utils/auditOversight');
const { buildPermissionMatrix } = require('../utils/permissionMatrix');
const { logAudit } = require('../utils/auditLogger');
const { listDefinitions, jobsEnabled } = require('../jobs');
const { walkChain } = require('../jobs/auditJob');
const { toEatDateString } = require('../utils/weekCycle');

// The Control Room's first screen: is the system healthy, what needs the super admin's attention,
// and where do the group's figures stand — in one call, so the page opens on an answer rather than
// a column of spinners.
//
// Every part is computed independently and failure of one is reported as that part's failure
// rather than failing the page. A control room that goes blank when the thing it is watching is
// broken is no use at the one moment it is wanted.
//
// Failed sign-ins, failed passbook tries, the officers table and the account posture already have
// a home (Audit trail → Oversight); this screen counts them and points there rather than showing
// them a second time.

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVERITY_ORDER = { high: 0, medium: 1, info: 2 };

// Runs one section, returns its value or `{ error }`.
async function section(label, run) {
  try {
    return await run();
  } catch (err) {
    return { error: `${label} could not be read: ${err.message}` };
  }
}

async function latestJobRuns(definitions) {
  const out = {};
  for (const definition of definitions) {
    const run = await JobRun.findOne({ name: definition.name }).sort({ startedAt: -1 }).lean();
    out[definition.name] = run
      ? {
          ok: run.ok,
          trigger: run.trigger,
          startedAt: run.startedAt,
          durationMs: run.durationMs,
          error: run.error || null,
          summary: run.summary || null,
        }
      : null;
  }
  return out;
}

// How many audit entries are currently marked "flagged" and not since cleared. The newest review
// of an entry is the one that counts.
async function openReviewCount() {
  const rows = await AuditReview.aggregate([
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$entry', status: { $first: '$status' } } },
    { $match: { status: 'flagged' } },
    { $count: 'n' },
  ]);
  return rows[0]?.n || 0;
}

// GET /api/superadmin/overview
async function overview(req, res, next) {
  try {
    const now = Date.now();
    const settings = await getOrCreateSettings();
    const definitions = listDefinitions();

    const [health, glance, accounts, auditWeek, jobRuns, openReviews, signIns] = await Promise.all([
      section('Health', async () => {
        const backup = await computeBackupHealth();
        return {
          api: {
            uptimeSeconds: Math.round(process.uptime()),
            node: process.version,
            environment: process.env.NODE_ENV || 'development',
          },
          database: {
            connected: mongoose.connection?.readyState === 1,
            name: mongoose.connection?.name || '',
          },
          mail: { configured: isMailConfigured() },
          photos: { configured: isCloudinaryConfigured() },
          backup,
        };
      }),
      section('The group’s figures', async () => {
        const [position, active, inactive, owed] = await Promise.all([
          computeMoneyPosition(),
          Member.countDocuments({ active: true }),
          Member.countDocuments({ active: false }),
          Fine.aggregate([
            { $match: { deleted: false, remaining: { $gt: 0 } } },
            { $group: { _id: null, total: { $sum: '$remaining' }, count: { $sum: 1 } } },
          ]),
        ]);
        return {
          members: { active, inactive },
          money: {
            totalContributed: position.totalContributed,
            totalExpenses: position.totalExpenses,
            netBalance: position.netBalance,
          },
          funds: position.funds.map((fund) => ({
            name: fund.name,
            balance: fund.balance,
            isRecoverable: fund.isRecoverable,
          })),
          fines: { owedTotal: owed[0]?.total || 0, owedCount: owed[0]?.count || 0 },
        };
      }),
      section('Accounts', async () => {
        const users = await User.find()
          .select('name email role active frozenAt createdAt lastLoginAt lastActiveAt failedLoginCount twoFactor.enabled')
          .lean();
        return users;
      }),
      section('The audit trail', async () => {
        const entries = await AuditLog.find({ createdAt: { $gte: new Date(now - 7 * DAY_MS) } })
          .select('action entityType before after performedBy')
          .populate('performedBy', 'role')
          .limit(2000)
          .lean();
        const read = entries.map(readAuditEntry);
        return {
          entries: entries.length,
          unusual: read.filter((e) => e.flags.length > 0).length,
          // The same bar as the banner on the dashboard and the alert emails: money or access
          // moving, by somebody other than the super admin.
          serious: countAttention(entries),
        };
      }),
      section('Scheduled jobs', () => latestJobRuns(definitions)),
      section('Reviews', openReviewCount),
      section('Sign-ins', async () => {
        const since = new Date(now - DAY_MS);
        const [failedSignIns, failedLookups] = await Promise.all([
          SecurityEvent.countDocuments({ kind: 'login_failed', createdAt: { $gte: since } }),
          SecurityEvent.countDocuments({ kind: 'gate_failed', createdAt: { $gte: since } }),
        ]);
        return { failedSignIns, failedLookups };
      }),
    ]);

    // --- what needs attention, worst first ------------------------------------------------------
    const attention = [];
    const flag = (severity, id, title, detail, link = null) =>
      attention.push({ severity, id, title, detail, link });

    if (health && !health.error) {
      if (!health.database.connected) {
        flag('high', 'db-down', 'The database is not connected', 'Nothing can be read or saved until it is back.');
      }
      if (health.backup?.never) {
        flag('high', 'backup-never', 'The books have never been downloaded', health.backup.note, 'data');
      } else if (health.backup?.stale) {
        flag('medium', 'backup-stale', `The last downloaded copy is ${health.backup.daysAgo} days old`, health.backup.note, 'data');
      }
      if (!health.mail.configured) {
        flag('info', 'mail-off', 'Email is not set up', 'Reminders, fine emails and password-reset links cannot be sent.');
      }
    }

    if (jobRuns && !jobRuns.error) {
      for (const [name, run] of Object.entries(jobRuns)) {
        if (run && !run.ok) {
          flag('high', `job-${name}`, `The ${name} job failed last time`, run.error || 'See Backups, restore and jobs.', 'data');
        }
      }
      const audit = jobRuns['audit-check'];
      if (audit?.ok && audit.summary && audit.summary.ok === false) {
        flag('high', 'audit-chain', 'The audit trail did not verify', audit.summary.break?.message || 'An entry was altered, removed or inserted.', 'audit');
      }
    }

    if (glance && !glance.error) {
      for (const fund of glance.funds) {
        if (!fund.isRecoverable && fund.balance < -0.005) {
          flag('high', `fund-${fund.name}`, `${fund.name} is overdrawn`, `It holds Ksh ${Number(fund.balance).toLocaleString('en-KE')}. More has been spent than was put in.`, '/admin/finance/expenses');
        }
      }
    }

    if (accounts && !accounts.error) {
      const staff = accounts.filter((u) => u.active);
      const supers = staff.filter((u) => u.role === 'super_admin');
      if (supers.length === 1) {
        flag('info', 'one-super', 'There is only one super admin', 'If that account is lost, nobody can restore, reset admins or change the group’s switches. Consider a second.', 'accounts');
      }
      for (const u of staff.filter((x) => (x.failedLoginCount || 0) >= 3)) {
        flag('medium', `failed-${u._id}`, `${u.name}: ${u.failedLoginCount} wrong passwords in a row`, 'Either they forgot, or somebody is guessing. You can sign them out or freeze the account.', 'accounts');
      }
      for (const u of staff.filter((x) => x.frozenAt)) {
        flag('info', `frozen-${u._id}`, `${u.name} is frozen`, 'They cannot sign in until you lift it.', 'accounts');
      }
      const stale = staff.filter((u) => !u.lastLoginAt && now - new Date(u.createdAt).getTime() > 7 * DAY_MS);
      if (stale.length) {
        flag('info', 'never-signed-in', `${stale.length} account${stale.length === 1 ? '' : 's'} created over a week ago, never used`, stale.map((u) => u.name).join(', '), 'accounts');
      }
      if (settings.twoFactorAuthEnabled) {
        const bare = staff.filter((u) => !u.twoFactor?.enabled);
        if (bare.length) {
          flag('info', 'no-2fa', `${bare.length} account${bare.length === 1 ? ' has' : 's have'} no second factor`, `Two-factor is on for the group but ${bare.map((u) => u.name).join(', ')} ${bare.length === 1 ? 'has' : 'have'} not enrolled.`, 'accounts');
        }
      }
    }

    if (auditWeek && !auditWeek.error && auditWeek.serious > 0) {
      flag('medium', 'audit-serious', `${auditWeek.serious} serious audit entr${auditWeek.serious === 1 ? 'y' : 'ies'} this week`, 'Amounts cut, money removed or moved, a role or phone number changed — by somebody else. Worth reading.', '/admin/audit');
    }
    if (typeof openReviews === 'number' && openReviews > 0) {
      flag('medium', 'reviews-open', `${openReviews} audit entr${openReviews === 1 ? 'y is' : 'ies are'} flagged for review`, 'You marked these for a second look and have not cleared them.', 'audit');
    }
    if (signIns && !signIns.error) {
      if (signIns.failedSignIns > 0) {
        flag('info', 'failed-sign-ins', `${signIns.failedSignIns} failed sign-in${signIns.failedSignIns === 1 ? '' : 's'} in the last day`, 'Who was tried, and from which address, is under Audit → Oversight.', '/admin/audit');
      }
      if (signIns.failedLookups > 0) {
        flag('info', 'failed-lookups', `${signIns.failedLookups} failed passbook ${signIns.failedLookups === 1 ? 'try' : 'tries'} in the last day`, 'Somebody typed an ID or phone number that did not open a record. Audit → Oversight lists them.', '/admin/audit');
      }
    }

    if (settings.maintenanceMode) {
      const since = settings.maintenanceSince ? new Date(settings.maintenanceSince).getTime() : now;
      flag(now - since > 2 * 60 * 60 * 1000 ? 'medium' : 'info', 'maintenance', 'Maintenance mode is on', 'Everyone but you can read and not write. Switch it off when you are done.', 'controls');
    }
    if (settings.membersAreaEnabled === false) {
      flag('medium', 'members-closed', 'The members’ area is closed', 'Members cannot open their passbooks.', 'controls');
    }

    const withoutId = await Member.countDocuments({
      active: true,
      nationalId: { $not: /^(?=.*\d)[A-Z0-9]{5,20}$/ },
    }).catch(() => 0);
    if (withoutId > 0) {
      flag('info', 'members-no-id', `${withoutId} active member${withoutId === 1 ? ' has' : 's have'} no usable ID`, 'They cannot open their own record until the office fills it in.', '/admin/members');
    }

    attention.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    // --- the accounts, summarised ---------------------------------------------------------------
    const accountSummary =
      accounts && !accounts.error
        ? {
            total: accounts.length,
            active: accounts.filter((u) => u.active).length,
            frozen: accounts.filter((u) => u.frozenAt).length,
            signedInToday: accounts.filter((u) => u.lastActiveAt && now - new Date(u.lastActiveAt).getTime() < DAY_MS).length,
          }
        : accounts;

    res.json({
      generatedAt: new Date(now).toISOString(),
      health:
        health && !health.error
          ? {
              ...health,
              jobs: {
                enabled: jobsEnabled(),
                list: definitions.map((definition) => ({
                  name: definition.name,
                  schedule: definition.schedule,
                  nextRunAt: definition.nextRunAt,
                  nextRunIn: definition.nextRunIn,
                  paused: (settings.pausedJobs || []).includes(definition.name),
                  lastRun: jobRuns && !jobRuns.error ? jobRuns[definition.name] : null,
                })),
              },
              auditChain:
                jobRuns && !jobRuns.error && jobRuns['audit-check']?.summary
                  ? {
                      ok: jobRuns['audit-check'].summary.ok !== false,
                      checkedAt: jobRuns['audit-check'].startedAt,
                      checked: jobRuns['audit-check'].summary.checked ?? null,
                      head: jobRuns['audit-check'].summary.head ?? null,
                    }
                  : null,
            }
          : health,
      attention,
      glance,
      accounts: accountSummary,
      audit:
        auditWeek && !auditWeek.error
          ? {
              ...auditWeek,
              flaggedForReview: typeof openReviews === 'number' ? openReviews : 0,
              failedSignIns: signIns && !signIns.error ? signIns.failedSignIns : null,
              failedLookups: signIns && !signIns.error ? signIns.failedLookups : null,
            }
          : auditWeek,
      controls: controlsOf(settings),
    });
  } catch (err) {
    next(err);
  }
}

// The group-wide switches in one shape, for the screen that edits them.
function controlsOf(settings) {
  return {
    maintenance: {
      enabled: Boolean(settings.maintenanceMode),
      message: settings.maintenanceMessage || '',
      since: settings.maintenanceSince || null,
    },
    lock: {
      lockedThrough: settings.lockedThrough ? toEatDateString(settings.lockedThrough) : null,
      reason: settings.lockReason || '',
    },
    switches: {
      membersAreaEnabled: settings.membersAreaEnabled !== false,
      fineEmailsEnabled: settings.fineEmailsEnabled !== false,
      reminderEmailsEnabled: settings.reminderEmailsEnabled !== false,
      constitutionVotingEnabled: settings.constitutionVotingEnabled !== false,
    },
    pausedJobs: settings.pausedJobs || [],
    twoFactorAuthEnabled: Boolean(settings.twoFactorAuthEnabled),
    passbookPhoneCheck: Boolean(settings.passbookPhoneCheck),
    cycle: {
      weeklyAmount: settings.weeklyAmount,
      chaiAmount: settings.chaiAmount,
      cycleStartWeek: settings.cycleStartWeek,
      weekAnchorDate: settings.weekAnchorDate ? toEatDateString(settings.weekAnchorDate) : null,
    },
  };
}

// POST /api/superadmin/audit-chain/verify — walk the whole chain now rather than on Saturday.
async function verifyAuditChainNow(req, res, next) {
  try {
    const result = await walkChain();
    await logAudit({
      action: 'create',
      entityType: 'System',
      entityId: req.user._id,
      performedBy: req.user._id,
      after: {
        action: 'audit-chain-verified-by-hand',
        ok: result.ok,
        checked: result.checked,
        head: result.head || null,
        break: result.ok ? null : { reason: result.break.reason, sequence: result.break.chainSequence },
      },
    });
    res.json({
      ok: result.ok,
      total: result.total,
      checked: result.checked,
      head: result.head || null,
      firstSequence: result.firstSequence ?? null,
      break: result.ok
        ? null
        : {
            reason: result.break.reason,
            sequence: result.break.chainSequence,
            entry: result.break.id,
            message: result.break.message,
          },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/superadmin/permissions — the grid, read from the routes this server is actually running.
async function permissions(req, res, next) {
  try {
    const roles = User.schema.path('role').enumValues;
    res.json(buildPermissionMatrix(req.app, roles));
  } catch (err) {
    next(err);
  }
}

module.exports = { overview, verifyAuditChainNow, permissions, controlsOf };
