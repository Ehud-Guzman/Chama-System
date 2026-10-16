const mongoose = require('mongoose');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const Fine = require('../models/Fine');
const ConstitutionDecision = require('../models/ConstitutionDecision');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { checkPassword, refuseUnlessConfirmed } = require('../utils/reauth');

// Two records for one person.
//
// The register is built from paper and from imports, and the same member ends up in it twice:
// once from the sheet, once typed by hand with a different spelling. The two records each hold part
// of his money, and the ordinary tools cannot join them — a member cannot be deleted while he holds
// money, and moving rows one at a time is how a balance gets lost.
//
// Merging moves everything that belongs to the duplicate onto the record being kept, then retires
// the duplicate (inactive, with a note saying where it went). Nothing is deleted: the duplicate's
// record stays, the audit trail names both, and every row that moved can be traced to where it was.
//
// Lives here, in the super admin's hands alone, because it rewrites whose money is whose.

async function loadPair(sourceId, targetId) {
  if (!mongoose.Types.ObjectId.isValid(String(sourceId)) || !mongoose.Types.ObjectId.isValid(String(targetId))) {
    return { error: { status: 400, message: 'Choose two members.' } };
  }
  if (String(sourceId) === String(targetId)) {
    return { error: { status: 400, message: 'Those are the same member. Choose two different records.' } };
  }
  const [source, target] = await Promise.all([Member.findById(sourceId), Member.findById(targetId)]);
  if (!source || !target) return { error: { status: 404, message: 'One of those members was not found.' } };
  return { source, target };
}

// What would move, counted. Shared by the preview and the real thing so the two cannot disagree.
async function describeMerge(source, target) {
  const [contributionRows, fineRows, sourceDecisions, targetDecisions] = await Promise.all([
    Contribution.aggregate([
      { $match: { memberId: source._id, deleted: false } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } },
    ]),
    Fine.aggregate([
      { $match: { memberId: source._id, deleted: false } },
      { $group: { _id: null, count: { $sum: 1 }, remaining: { $sum: '$remaining' } } },
    ]),
    ConstitutionDecision.find({ memberId: source._id }).select('chapterNumber').lean(),
    ConstitutionDecision.find({ memberId: target._id }).select('chapterNumber').lean(),
  ]);

  const targetChapters = new Set(targetDecisions.map((d) => d.chapterNumber));
  const decisionsToMove = sourceDecisions.filter((d) => !targetChapters.has(d.chapterNumber)).length;

  const warnings = [];
  if (!target.active) warnings.push('The record you are keeping is inactive. Merging onto an inactive member is usually a mistake.');
  if (!source.active) warnings.push('The duplicate is already inactive.');
  if (decisionsToMove < sourceDecisions.length) {
    warnings.push(`${sourceDecisions.length - decisionsToMove} constitution verdict(s) on the duplicate cover chapters the kept record already voted on. A verdict is permanent, so those stay on the duplicate.`);
  }

  return {
    source: summarise(source),
    target: summarise(target),
    moves: {
      contributions: { count: contributionRows[0]?.count || 0, total: contributionRows[0]?.total || 0 },
      fines: { count: fineRows[0]?.count || 0, stillOwed: fineRows[0]?.remaining || 0 },
      openingBalance: Number(source.openingBalance) || 0,
      balanceDebits: (source.fineDebits || []).length,
      constitutionVerdicts: decisionsToMove,
    },
    warnings,
  };
}

function summarise(member) {
  return {
    id: member._id,
    name: member.name,
    regNumber: member.regNumber || '',
    phone: member.phone,
    active: member.active,
    openingBalance: Number(member.openingBalance) || 0,
  };
}

// POST /api/superadmin/members/merge/preview { sourceId, targetId }
async function previewMerge(req, res, next) {
  try {
    const pair = await loadPair(req.body?.sourceId, req.body?.targetId);
    if (pair.error) return res.status(pair.error.status).json({ message: pair.error.message });
    res.json(await describeMerge(pair.source, pair.target));
  } catch (err) {
    next(err);
  }
}

// Runs `work(session)` inside a transaction when the deployment supports one, and without when it
// does not (a standalone MongoDB, as in the rehearsal). The steps are ordered so the unprotected
// path is the same sequence, merely without the all-or-nothing guarantee.
async function maybeTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    try {
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } catch (err) {
      if (/replica set|Transaction numbers|transactions are not supported/i.test(String(err.message))) {
        return await work(null);
      }
      throw err;
    }
  } finally {
    await session.endSession();
  }
}

// POST /api/superadmin/members/merge { sourceId, targetId, reason, password }
async function mergeMembers(req, res, next) {
  try {
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (reason.length < 5) {
      return res.status(400).json({ message: 'Say why these two are the same person — it goes on both records.' });
    }
    if (refuseUnlessConfirmed(await checkPassword(req), res)) return;

    const pair = await loadPair(req.body?.sourceId, req.body?.targetId);
    if (pair.error) return res.status(pair.error.status).json({ message: pair.error.message });
    const { source, target } = pair;

    const plan = await describeMerge(source, target);
    const beforeSource = snapshot(source);
    const beforeTarget = snapshot(target);

    await maybeTransaction(async (session) => {
      const opts = session ? { session } : {};

      await Contribution.updateMany({ memberId: source._id }, { $set: { memberId: target._id } }, opts);
      await Fine.updateMany({ memberId: source._id }, { $set: { memberId: target._id } }, opts);

      // Verdicts the kept record has not given yet. (member, chapter) is unique, so the ones that
      // would collide are exactly the ones left behind.
      const targetChapters = (await ConstitutionDecision.find({ memberId: target._id }, 'chapterNumber', opts).lean()).map((d) => d.chapterNumber);
      await ConstitutionDecision.updateMany(
        { memberId: source._id, chapterNumber: { $nin: targetChapters } },
        { $set: { memberId: target._id } },
        opts
      );

      // The money held on the member himself.
      const note = `Merged from ${source.name}${source.regNumber ? ` (${source.regNumber})` : ''}: ${reason}`;
      target.openingBalance = (Number(target.openingBalance) || 0) + (Number(source.openingBalance) || 0);
      target.openingBalanceNote = [target.openingBalanceNote, Number(source.openingBalance) ? `+${source.openingBalance} carried in from ${source.name}` : '']
        .filter(Boolean)
        .join('; ');
      target.fineDebits = [...(target.fineDebits || []), ...(source.fineDebits || [])];
      target.notes = [target.notes, note].filter(Boolean).join('\n').slice(0, 2000);
      await target.save(opts);

      // The duplicate stays on file, retired, saying where it went.
      source.openingBalance = 0;
      source.fineDebits = [];
      source.active = false;
      source.deactivatedAt = new Date();
      source.resignedAt = source.resignedAt || new Date();
      source.resignationReason = `Duplicate record — merged into ${target.name}${target.regNumber ? ` (${target.regNumber})` : ''}`;
      source.resignationSettlement = 'Everything he held and owed was moved onto the record that was kept.';
      source.notes = [source.notes, `Merged into ${target.name}: ${reason}`].filter(Boolean).join('\n').slice(0, 2000);
      await source.save(opts);
    });

    await logAudit({
      action: 'update',
      entityType: 'Member',
      entityId: target._id,
      performedBy: req.user._id,
      before: beforeTarget,
      after: snapshot(target),
    });
    await logAudit({
      action: 'update',
      entityType: 'Member',
      entityId: source._id,
      performedBy: req.user._id,
      before: beforeSource,
      after: snapshot(source),
    });
    await logAudit({
      action: 'update',
      entityType: 'System',
      entityId: target._id,
      performedBy: req.user._id,
      after: { action: 'members-merged', reason, from: plan.source, into: plan.target, moved: plan.moves },
    });

    res.json({ ok: true, ...(await describeMerge(source, target)), merged: plan.moves });
  } catch (err) {
    next(err);
  }
}

// POST /api/superadmin/members/:id/reinstate { reason, password }
//
// A member who resigned by mistake, or came back. The register's ordinary screens can switch a
// member off but have no way to switch him back on, so the only repair was to type him in again as
// a second record — which is how duplicates are made. This clears the resignation (what the member
// record already does when its active flag is set), keeps what it said in the audit trail, and
// writes the reason on the member himself.
//
// His weeks while he was away are not forgiven: with the resignation cleared, the ledger counts him
// from his join date to today, so the gap shows as weeks to settle on his own record.
async function reinstateMember(req, res, next) {
  try {
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (reason.length < 5) {
      return res.status(400).json({ message: 'Say why he is being brought back — it goes on his record.' });
    }
    if (refuseUnlessConfirmed(await checkPassword(req), res)) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: 'Member not found' });
    }
    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    if (member.active) return res.status(400).json({ message: 'He is a current member already.' });

    const before = snapshot(member);
    const was = member.resignationReason ? ` (he had left: ${member.resignationReason})` : '';
    member.active = true;
    member.deactivatedAt = null;
    member.resignedAt = null;
    member.resignationReason = '';
    member.resignationSettlement = '';
    member.notes = [member.notes, `Reinstated by the super admin: ${reason}${was}`].filter(Boolean).join('\n').slice(0, 2000);
    await member.save();

    await logAudit({
      action: 'update',
      entityType: 'Member',
      entityId: member._id,
      performedBy: req.user._id,
      before,
      after: snapshot(member),
    });
    await logAudit({
      action: 'update',
      entityType: 'System',
      entityId: member._id,
      performedBy: req.user._id,
      after: { action: 'member-reinstated', reason, member: summarise(member) },
    });
    res.json({ ok: true, member: summarise(member) });
  } catch (err) {
    next(err);
  }
}

module.exports = { previewMerge, mergeMembers, reinstateMember };
