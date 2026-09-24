const Fine = require('../models/Fine');
const Member = require('../models/Member');
const FineType = require('../models/FineType');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { getOrCreateSettings } = require('../utils/settings');
const { readMoney } = require('../utils/money');
const { sendWorkbook } = require('../utils/xlsxExport');
// The member is told as the fine is written, and told again when he pays it. Neither
// send can fail this request: utils/fineEmails catches everything and writes the
// outcome to the request log.
const { announceFineIssued, announceFinesPaid } = require('../utils/fineEmails');
const { buildFineReport, renderFineReportPdf, fineReportSheets,
  buildFineGroupReport, renderFineGroupReportPdf, fineGroupReportSheets,
} = require('../utils/fineReport');

// The disciplinary officer works in his own world: he issues conduct fines and has
// no business reading the treasurer's. So every read he makes is narrowed to
// disciplinary-category types — the same boundary createFine already enforces when
// he issues one — and his exports say so on the page.
async function scopeForUser(user) {
  if (user.role !== 'disciplinary') return { isScoped: false, filter: {}, scopeLabel: 'All fines' };

  const typeIds = await FineType.distinct('_id', { category: 'disciplinary' });
  return {
    isScoped: true,
    filter: { typeId: { $in: typeIds } },
    scopeLabel: 'Disciplinary fines',
  };
}

// The totals a screen or a report shows above the list.
function summariseFines(fines) {
  const issued = fines.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
  const outstanding = fines.reduce((sum, f) => sum + (Number(f.remaining) || 0), 0);
  return {
    count: fines.length,
    issued,
    outstanding,
    cleared: issued - outstanding,
    pendingCount: fines.filter((f) => Number(f.remaining) > 0).length,
    clearedCount: fines.filter((f) => Number(f.remaining) <= 0).length,
  };
}

function toFineJson(fine) {
  return {
    id: fine._id,
    date: fine.date,
    amount: fine.amount,
    remaining: fine.remaining,
    reason: fine.reason || '',
    status: Number(fine.remaining) > 0 ? 'pending' : 'settled',
    type: fine.typeId?.name || null,
    category: fine.typeId?.category || null,
    memberId: fine.memberId?._id || fine.memberId,
    memberName: fine.memberId?.name || null,
    memberRegNumber: fine.memberId?.regNumber || null,
    issuedBy: fine.issuedBy?.name || null,
    voided: fine.deleted === true,
  };
}

// GET /api/fines?memberId=&status=pending|settled|voided&page=&limit=
// Admin sees every fine; the disciplinary officer sees his own category only.
async function listFines(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const scope = await scopeForUser(req.user);
    const filter = { ...scope.filter, deleted: req.query.status === 'voided' };
    if (req.query.memberId) filter.memberId = req.query.memberId;
    if (req.query.status === 'pending') filter.remaining = { $gt: 0 };
    if (req.query.status === 'settled') filter.remaining = { $lte: 0 };

    const [fines, total, all] = await Promise.all([
      Fine.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('memberId', 'name phone regNumber')
        .populate('typeId', 'name category')
        .populate('issuedBy', 'name')
        .lean(),
      Fine.countDocuments(filter),
      // The summary is over every fine in scope, not just this page: a screen that
      // totalled only the rows it happened to load would under-report the debt.
      Fine.find({ ...scope.filter, deleted: false })
        .select('amount remaining')
        .lean(),
    ]);

    res.json({
      fines: fines.map(toFineJson),
      summary: summariseFines(all),
      scopeLabel: scope.scopeLabel,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/fines/member/:memberId/export?format=pdf|xlsx — ADMIN & DISCIPLINARY.
// One member's whole fine record: issued, paid off, outstanding, and what was
// voided. The disciplinary officer asked for this so he can hand a member (or a
// meeting) a proper document instead of reading a screen aloud.
async function exportMemberFines(req, res, next) {
  try {
    const member = await Member.findById(req.params.memberId).lean();
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const scope = await scopeForUser(req.user);
    const [fines, voidedFines, settings] = await Promise.all([
      Fine.find({ ...scope.filter, memberId: member._id, deleted: false })
        .sort({ date: -1, createdAt: -1 })
        .populate('typeId', 'name category')
        .populate('issuedBy', 'name')
        .lean(),
      Fine.find({ ...scope.filter, memberId: member._id, deleted: true })
        .sort({ date: -1 })
        .populate('typeId', 'name category')
        .populate('issuedBy', 'name')
        .lean(),
      getOrCreateSettings(),
    ]);

    const report = buildFineReport({
      member,
      fines,
      voidedFines,
      scopeLabel: scope.scopeLabel,
    });

    const slug = (member.regNumber || member.name || 'member').replace(/[^a-z0-9]+/gi, '-');
    const format = String(req.query.format || 'pdf').toLowerCase();

    if (format === 'xlsx' || format === 'excel') {
      return sendWorkbook(res, `fines-${slug}.xlsx`, fineReportSheets(report, settings.chamaName));
    }

    return renderFineReportPdf(res, report, settings.chamaName);
  } catch (err) {
    next(err);
  }
}

// POST /api/fines
async function createFine(req, res, next) {
  try {
    const { memberId, typeId, amount, reason, date } = req.body || {};

    const [member, type] = await Promise.all([
      Member.findById(memberId),
      FineType.findById(typeId),
    ]);
    if (!member || !member.active) {
      return res.status(400).json({ message: 'Member not found or inactive' });
    }
    if (!type || !type.active) {
      return res.status(400).json({ message: 'Fine type not found or inactive' });
    }
    // The disciplinary role only ever issues disciplinary-category fines —
    // financial fine types stay with the treasurer/admin.
    if (req.user.role === 'disciplinary' && type.category !== 'disciplinary') {
      return res.status(403).json({ message: 'You can only issue disciplinary fine types' });
    }
    const n = Number(amount) > 0 ? Number(amount) : type.defaultAmount;
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ message: 'Amount must be a number greater than zero' });
    }

    const fine = await Fine.create({
      memberId: member._id,
      typeId: type._id,
      amount: n,
      remaining: n,
      reason: String(reason || '').trim(),
      date: date ? new Date(date) : new Date(),
      issuedBy: req.user._id,
    });

    await logAudit({
      action: 'create',
      entityType: 'Fine',
      entityId: fine._id,
      performedBy: req.user._id,
      after: snapshot(fine),
    });

    const populated = await Fine.findById(fine._id)
      .populate('memberId', 'name phone regNumber')
      .populate('typeId', 'name')
      .lean();

    // The member is told his own fine exists, as it is written rather than at the next
    // meeting. Not awaited on purpose: recording a fine must not depend on a mail
    // server answering in time, and the send's outcome goes to the request log.
    announceFineIssued({ fine: populated, member, performedBy: req.user._id, rid: req.id });

    res.status(201).json({ fine: populated });
  } catch (err) {
    next(err);
  }
}

// POST /api/fines/:id/settle — manual settlement (e.g. member paid cash directly,
// not through a logged contribution).
async function settleFine(req, res, next) {
  try {
    const fine = await Fine.findById(req.params.id);
    if (!fine || fine.deleted) return res.status(404).json({ message: 'Fine not found' });
    if (fine.remaining <= 0) return res.status(400).json({ message: 'Fine is already settled' });

    const read = readMoney(req.body?.amount, { min: 0.01, label: 'Amount' });
    if (read.error) return res.status(400).json({ message: read.error });

    // The day the money actually changed hands, which is not always the day it is
    // keyed in — cash handed over at a meeting is often recorded days later, and
    // the fine's own record is what the disciplinary report prints.
    let paidAt = new Date();
    if (req.body?.date) {
      const parsed = new Date(req.body.date);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ message: 'Invalid date' });
      }
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      if (parsed > endOfToday) {
        return res.status(400).json({ message: 'Date cannot be in the future' });
      }
      if (parsed < new Date(fine.date)) {
        return res.status(400).json({ message: 'A fine cannot be paid before it was issued' });
      }
      paidAt = parsed;
    }

    const before = snapshot(fine);
    const applied = Math.min(read.value, fine.remaining);
    fine.remaining = Math.round((fine.remaining - applied) * 100) / 100;
    fine.settlements.push({ contributionId: null, amount: applied, date: paidAt });

    await fine.save();
    await logAudit({
      action: 'update',
      entityType: 'Fine',
      entityId: fine._id,
      performedBy: req.user._id,
      before,
      after: snapshot(fine),
    });

    await fine.populate('typeId', 'name category');

    // The member is told what was received and what is left on the fine. Not awaited:
    // the settlement is already written and audited, and a slow mail server must not
    // hold up the office's screen.
    if (applied > 0) {
      Member.findById(fine.memberId)
        .select('name email emailNotifications')
        .lean()
        .then((member) =>
          announceFinesPaid({
            payments: [
              {
                label: fine.reason || fine.typeId?.name || 'Fine',
                amount: applied,
                remaining: fine.remaining,
              },
            ],
            member,
            totalPaid: applied,
            paidAt,
            performedBy: req.user._id,
            rid: req.id,
          })
        )
        .catch(() => {
          // Nothing to do about a failure to read the member here: the payment is
          // recorded either way, and the log line the send would have written is
          // replaced by nothing at all rather than by a broken request.
        });
    }

    res.json({ fine: toFineJson(fine) });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/fines/:id — void a wrongly-issued fine (soft delete)
async function voidFine(req, res, next) {
  try {
    const fine = await Fine.findById(req.params.id);
    if (!fine || fine.deleted) return res.status(404).json({ message: 'Fine not found' });
    const before = snapshot(fine);

    fine.deleted = true;
    await fine.save();
    await logAudit({
      action: 'delete',
      entityType: 'Fine',
      entityId: fine._id,
      performedBy: req.user._id,
      before,
      after: snapshot(fine),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// GET /api/fines/summary — the group's fines in the four cuts a meeting works
// through: the totals, the fine types carrying the debt, who owes it, and how it
// has moved month by month. Scoped exactly like listFines, so the disciplinary
// officer's report can only ever count his own category of fines.
async function finesSummary(req, res, next) {
  try {
    const scope = await scopeForUser(req.user);
    const fines = await Fine.find({ ...scope.filter, deleted: false })
      .populate('memberId', 'name regNumber phone active')
      .populate('typeId', 'name category')
      .populate('issuedBy', 'name')
      .lean();

    const report = buildFineGroupReport({ fines, scopeLabel: scope.scopeLabel });
    report.preparedBy = req.user?.name || '';

    res.json({
      scopeLabel: report.scopeLabel,
      totals: report.totals,
      byType: report.byType,
      byMember: report.byMember,
      byMonth: report.byMonth,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/fines/export?format=pdf|xlsx — the same group report as a document.
async function exportFines(req, res, next) {
  try {
    const scope = await scopeForUser(req.user);
    const [fines, settings] = await Promise.all([
      Fine.find({ ...scope.filter, deleted: false })
        .populate('memberId', 'name regNumber phone active')
        .populate('typeId', 'name category')
        .populate('issuedBy', 'name')
        .lean(),
      getOrCreateSettings(),
    ]);

    const report = buildFineGroupReport({ fines, scopeLabel: scope.scopeLabel });
    report.preparedBy = req.user?.name || '';

    const format = String(req.query.format || 'pdf').toLowerCase();
    if (format === 'xlsx' || format === 'excel') {
      return sendWorkbook(res, 'fines-group.xlsx', fineGroupReportSheets(report, settings.chamaName));
    }
    return renderFineGroupReportPdf(res, report, settings.chamaName);
  } catch (err) {
    next(err);
  }
}

module.exports = { listFines, finesSummary, exportFines, exportMemberFines, createFine, settleFine, voidFine };
