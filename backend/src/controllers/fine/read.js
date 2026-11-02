// The fines controller, part: read. controllers/fineController.js is the index the routes use.

const Member = require('../../models/Member');
const Fine = require('../../models/Fine');
const { getOrCreateSettings } = require('../../utils/settings');
const { buildFineReport, fineReportSheets, renderFineReportPdf, buildFineGroupReport, fineGroupReportSheets, renderFineGroupReportPdf } = require('../../utils/fineReport');
const { sendWorkbook } = require('../../utils/xlsxExport');
const { scopeForUser, summariseFines, toFineJson } = require('./common');

// GET /api/fines?memberId=&status=pending|settled|voided&page=&limit=
// Admin sees every fine; the disciplinary officer sees his own category only.
async function listFines(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const scope = await scopeForUser(req.user);
    const filter = { ...scope.filter, deleted: req.query.status === 'voided' };
    if (req.query.memberId) filter.memberId = req.query.memberId;
    // Find a member's fines by typing a bit of his name, phone or registration number — the way
    // the office looks somebody up at a meeting.
    const search = String(req.query.search || '').trim().slice(0, 60);
    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const ids = await Member.find({ $or: [{ name: pattern }, { phone: pattern }, { regNumber: pattern }] })
        .select('_id')
        .limit(200)
        .lean();
      filter.memberId = filter.memberId
        ? { $in: ids.map((m) => m._id).filter((id) => String(id) === String(filter.memberId)) }
        : { $in: ids.map((m) => m._id) };
    }
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

module.exports = {
  exportFines,
  exportMemberFines,
  finesSummary,
  listFines,
};
