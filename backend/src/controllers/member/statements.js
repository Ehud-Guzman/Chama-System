// The members' controller, part: statements. controllers/memberController.js is the index the routes use.

const Member = require('../../models/Member');
const AuditLog = require('../../models/AuditLog');
const { getOrCreateSettings } = require('../../utils/settings');
const { renderMemberStatementPdf, memberStatementPdfBuffer } = require('../../utils/memberStatementPdf');
const { sendWorkbook } = require('../../utils/xlsxExport');
const { memberStatementSheets } = require('../../utils/memberStatement');
const { resolvePeriod } = require('../../utils/statementPeriod');
const { assertMailConfigured, cleanEmail, isValidEmail, buildStatementEmail, sendMail, mailFailure } = require('../../utils/mailer');
const { logAudit } = require('../../utils/auditLogger');
const { buildPublicProfile } = require('./profile');

// Renders a buildPublicProfile() result as a downloadable statement. Both formats
// come from the same profile, so a member's own download and the office's copy can
// never tell two different stories — the only difference between them is whether
// the Tea Fund is named (see buildPublicProfile).
async function sendStatement(res, profile) {
  const settings = await getOrCreateSettings();
  renderMemberStatementPdf(res, profile, settings.chamaName);
}

// The workbook: a sheet per question the office asks, built from the same profile.
async function sendStatementExcel(res, profile) {
  const settings = await getOrCreateSettings();
  const slug = (profile.regNumber || profile.name || 'member').replace(/[^a-z0-9]+/gi, '-');
  sendWorkbook(res, `statement-${slug}.xlsx`, memberStatementSheets(profile, settings.chamaName));
}

// Reads the period off a statement request, or answers 400 with the sentence.
//
// Shared by all four statement endpoints — the member's own two and the office's two — because a
// period that one of them accepted and another refused would be a support call nobody could
// reproduce. `undefined` period (nothing asked for) is the whole-book statement and always valid.
function readStatementPeriod(req, res) {
  const period = resolvePeriod(req.query, { now: Date.now() });
  if (period && period.error) {
    res.status(400).json({ message: period.error });
    return { failed: true };
  }
  return { period };
}

// GET /api/public/lookup/statement — MEMBER PASS (utils/memberToken), the passbook kind.
// `?year=`, `?quarter=`, `?from=&to=` and `?range=` narrow it to a period. No ID and no phone
// number in the request: both were spent at the lookup, and what the lookup handed back is what
// proves them here.
async function publicLookupStatement(req, res, next) {
  try {
    const read = readStatementPeriod(req, res);
    if (read.failed) return undefined;
    await sendStatement(
      res,
      await buildPublicProfile(req.member, {
        self: true,
        period: read.period,
        contactsVerified: req.memberAccess.phoneVerified,
      })
    );
  } catch (err) {
    next(err);
  }
}

// GET /api/public/lookup/statement/excel — MEMBER PASS, the passbook kind
async function publicLookupStatementExcel(req, res, next) {
  try {
    const read = readStatementPeriod(req, res);
    if (read.failed) return undefined;
    await sendStatementExcel(
      res,
      await buildPublicProfile(req.member, {
        self: true,
        period: read.period,
        contactsVerified: req.memberAccess.phoneVerified,
      })
    );
  } catch (err) {
    next(err);
  }
}

// GET /api/members/:id/statement — admin, any member regardless of active status.
// The office's copy keeps the group's funds in it (see buildPublicProfile).
async function memberStatement(req, res, next) {
  try {
    const member = await Member.findById(req.params.id).lean();
    if (!member) return res.status(404).json({ message: 'Member not found' });
    const read = readStatementPeriod(req, res);
    if (read.failed) return undefined;
    await sendStatement(
      res,
      await buildPublicProfile(member, { includeTeaFund: true, period: read.period })
    );
  } catch (err) {
    next(err);
  }
}

// POST /api/members/:id/statement/email — ADMIN or TREASURER. `?year=`, `?quarter=`, `?from=&to=`,
// `?range=` narrow it to a period, exactly as the downloads do.
//
// Sends the MEMBER'S OWN copy of his statement (the one his passbook downloads, which does not name
// the Tea Fund) to the address on his record, as a PDF. Built from the same profile and the same
// renderer as the download, so what is mailed is what the office would hand over.
//
// Held back where a person would hold it back: no address on file, or he has switched emails off; and
// no more than three a day to one member, so a button pressed in a hurry cannot become a flood.
const STATEMENT_EMAILS_PER_DAY = 3;

async function emailMemberStatement(req, res, next) {
  try {
    const member = await Member.findById(req.params.id).lean();
    if (!member) return res.status(404).json({ message: 'Member not found' });

    // The mail-not-set-up refusal first, in the sentence every sender uses.
    assertMailConfigured();

    const address = cleanEmail(member.email);
    if (!address || !isValidEmail(address)) {
      return res.status(400).json({
        message: `There is no usable email address on ${member.name}'s record. Add one (Edit), then send it.`,
      });
    }
    if (member.emailNotifications === false) {
      return res.status(400).json({
        message: `${member.name} has switched email off, so the statement was not sent. He can still download it from his passbook.`,
      });
    }

    const read = readStatementPeriod(req, res);
    if (read.failed) return undefined;

    const sentToday = await AuditLog.countDocuments({
      entityType: 'Notification',
      entityId: member._id,
      'after.kind': 'statement',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (sentToday >= STATEMENT_EMAILS_PER_DAY) {
      return res.status(429).json({
        message: `${member.name} has already been sent ${STATEMENT_EMAILS_PER_DAY} statements in the last day. Ask him to check his inbox, or try again tomorrow.`,
      });
    }

    const settings = await getOrCreateSettings();
    const profile = await buildPublicProfile(member, { self: true, period: read.period });
    const pdf = await memberStatementPdfBuffer(profile, settings.chamaName);
    const slug = (profile.regNumber || profile.name || 'member').replace(/[^a-z0-9]+/gi, '-');
    const periodLabel = profile.period?.label || read.period?.label || '';
    const { subject, html, text } = buildStatementEmail({ chamaName: settings.chamaName, member, periodLabel });

    try {
      await sendMail({
        to: address,
        subject,
        html,
        text,
        attachments: [{ filename: `statement-${slug}.pdf`, content: pdf, contentType: 'application/pdf' }],
      });
    } catch (err) {
      throw mailFailure(err);
    }

    await logAudit({
      action: 'create',
      entityType: 'Notification',
      entityId: member._id,
      performedBy: req.user._id,
      after: { channel: 'email', kind: 'statement', to: address, subject, period: periodLabel || 'everything to date' },
    });
    res.json({ ok: true, to: address, period: periodLabel || null });
  } catch (err) {
    next(err);
  }
}

// GET /api/members/:id/statement/excel — ADMIN
async function memberStatementExcel(req, res, next) {
  try {
    const member = await Member.findById(req.params.id).lean();

    if (!member) {
      return res.status(404).json({
        message: 'Member not found',
      });
    }

    const read = readStatementPeriod(req, res);
    if (read.failed) return undefined;

    await sendStatementExcel(
      res,
      // The office's copy: it keeps the Tea Fund in it, as the finance ledger
      // does — a member's own download from the lookup leaves it out.
      await buildPublicProfile(member, { includeTeaFund: true, period: read.period })
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  emailMemberStatement,
  memberStatement,
  memberStatementExcel,
  publicLookupStatement,
  publicLookupStatementExcel,
};
