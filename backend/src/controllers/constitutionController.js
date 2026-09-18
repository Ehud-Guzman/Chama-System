const ConstitutionDecision = require('../models/ConstitutionDecision');
const { findActiveMemberByNationalId } = require('../utils/publicAccess');
const { loadConstitution } = require('../utils/constitutionData');

// The chapter list is a row in the database now (see utils/constitutionData), so
// the total and the number→chapter map are derived from the loaded text per
// request instead of being frozen into module state at import time. The load is
// cached for a minute, so this is not a query per page view.
async function chapterIndex() {
  const { meta, chapters, source } = await loadConstitution();
  return {
    meta,
    chapters,
    source,
    total: chapters.length,
    byNumber: new Map(chapters.map((c) => [c.number, c])),
  };
}

// Every decision one member has taken, as the shape both sides of the wire use:
// the member's own reading page and the office's copy of it on his profile.
// The total comes from the same place the text does, so a constitution that grew
// a chapter overnight cannot make a member's progress read over 100%.
async function decisionsForMember(memberId) {
  const [{ total }, rows] = await Promise.all([
    chapterIndex(),
    ConstitutionDecision.find({ memberId }).sort({ chapterNumber: 1 }).lean(),
  ]);
  const approved = rows.filter((r) => r.decision === 'approved').length;
  const rejected = rows.length - approved;
  const decided = Math.min(rows.length, total);

  return {
    total,
    decided,
    approved,
    rejected,
    pending: Math.max(0, total - decided),
    decisions: rows.map((row) => ({
      chapterNumber: row.chapterNumber,
      chapterTitle: row.chapterTitle || '',
      decision: row.decision,
      reason: row.reason || '',
      decidedAt: row.decidedAt || row.createdAt,
    })),
  };
}


// GET /api/public/constitution?nationalId= — MEMBERS ONLY.
//
// The constitution is the group's own document, so it sits behind the same gate
// as the document vault and the minutes: an ID recorded against an active member,
// or nothing at all.
//
// The text is served from here rather than bundled into the public JavaScript on
// purpose. A reader that shipped the whole constitution to the browser and merely
// hid it behind a click would leave it one devtools download away for anyone who
// never signed in — the gate would be decorative. Anything a member is not meant
// to see without proving his ID has to come from the server.
//
// The member's own approve/reject record travels with the text, so the reading
// page can badge each chapter without a second request.
async function publicConstitution(req, res, next) {
  try {
    const gate = await findActiveMemberByNationalId(req.query.nationalId);
    if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });
    const member = gate.member;
    const { meta, chapters } = await chapterIndex();

    // Never let a shared device or a proxy cache a document unlocked by an ID —
    // the same rule the document vault follows.
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      meta,
      chapters,
      summary: await decisionsForMember(member._id),
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/public/constitution/decision — MEMBERS ONLY (by the same ID gate).
// { nationalId, chapterNumber, decision: 'approved' | 'rejected', reason? }
//
// A decision is written once and never changed: the row is inserted, the pair
// (member, chapter) is uniquely indexed, and no route updates it. That is what
// makes "not undoable" true in the database and not only in the UI — and it is
// the same record the office sees on the member's profile.
async function publicConstitutionDecision(req, res, next) {
  try {
    const gate = await findActiveMemberByNationalId(
      req.body?.nationalId || req.query.nationalId
    );
    if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });
    const member = gate.member;

    const chapterNumber = Number(req.body?.chapterNumber);
    const { meta, byNumber } = await chapterIndex();
    const chapter = byNumber.get(chapterNumber);
    if (!chapter) {
      return res.status(400).json({ message: 'That chapter does not exist' });
    }

    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ message: 'Choose to approve or reject the chapter' });
    }

    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (decision === 'rejected' && !reason) {
      return res.status(400).json({ message: 'Say briefly why you are rejecting this chapter' });
    }

    const already = await ConstitutionDecision.findOne({
      memberId: member._id,
      chapterNumber,
    }).lean();
    if (already) {
      return res.status(409).json({
        message:
          'You have already recorded your decision on this chapter, and a decision cannot be changed.',
      });
    }

    try {
      await ConstitutionDecision.create({
        memberId: member._id,
        memberName: member.name,
        chapterNumber,
        chapterTitle: chapter.title,
        decision,
        reason,
        edition: meta.eyebrow || '',
        decidedAt: new Date(),
      });
    } catch (err) {
      // The unique index is the real guard: a double tap that slips past the read
      // above lands here, and still changes nothing.
      if (err.code === 11000) {
        return res.status(409).json({
          message:
            'You have already recorded your decision on this chapter, and a decision cannot be changed.',
        });
      }
      throw err;
    }

    res.status(201).json({
      chapterNumber,
      decision,
      summary: await decisionsForMember(member._id),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { publicConstitution, publicConstitutionDecision, decisionsForMember };
