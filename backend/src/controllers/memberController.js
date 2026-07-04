const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const { normalizePhone } = require('../utils/phone');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { parseMembersCSV } = require('../utils/csvImport');
const { typeBreakdown } = require('../utils/typeBreakdown');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Sequential reg numbers: CM-0001, CM-0002, ... Retries on the rare duplicate.
async function nextRegNumber() {
  const last = await Member.findOne({ regNumber: /^CM-\d+$/ })
    .sort({ regNumber: -1 })
    .select('regNumber');
  const lastNum = last ? parseInt(last.regNumber.slice(3), 10) : 0;
  return `CM-${String(lastNum + 1).padStart(4, '0')}`;
}

// GET /api/members?search=&status=&page=&limit=
async function listMembers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const status = req.query.status || 'active';
    const search = String(req.query.search || '').trim();

    const filter = {};
    if (status === 'active') filter.active = true;
    if (status === 'inactive') filter.active = false;
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      // Phone searches should also match normalized storage format
      const normalized = normalizePhone(search);
      filter.$or = [
        { name: rx },
        { phone: normalized ? normalized : rx },
        { regNumber: rx },
      ];
    }

    const [members, total] = await Promise.all([
      Member.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Member.countDocuments(filter),
    ]);

    // Per-member totals + last contribution date for the card list
    const ids = members.map((m) => m._id);
    const sums = await Contribution.aggregate([
      { $match: { memberId: { $in: ids }, deleted: false } },
      {
        $group: {
          _id: '$memberId',
          totalContributed: { $sum: '$amount' },
          lastContributionDate: { $max: '$date' },
        },
      },
    ]);
    const sumMap = new Map(sums.map((s) => [String(s._id), s]));

    res.json({
      members: members.map((m) => ({
        ...m,
        totalContributed: sumMap.get(String(m._id))?.totalContributed || 0,
        lastContributionDate: sumMap.get(String(m._id))?.lastContributionDate || null,
      })),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/members/:id — member + contribution history
async function getMember(req, res, next) {
  try {
    const member = await Member.findById(req.params.id).lean();
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const [contributions, byType] = await Promise.all([
      Contribution.find({ memberId: member._id, deleted: false })
        .sort({ date: -1, createdAt: -1 })
        .populate('loggedBy', 'name')
        .populate('typeId', 'name')
        .lean(),
      typeBreakdown(member._id),
    ]);
    const totalContributed = contributions.reduce((sum, c) => sum + c.amount, 0);
    const totalPledged = byType.reduce((sum, b) => sum + b.pledged, 0);

    res.json({ member, contributions, totalContributed, totalPledged, byType });
  } catch (err) {
    next(err);
  }
}

// POST /api/members
async function createMember(req, res, next) {
  try {
    const { name, phone, regNumber, notes } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }
    const normalized = normalizePhone(String(phone || ''));
    if (!normalized) {
      return res.status(400).json({ message: 'Enter a valid phone number (e.g. 0712 345 678)' });
    }

    const doc = {
      name: String(name).trim(),
      phone: normalized,
      notes: String(notes || '').trim(),
      createdBy: req.user._id,
    };
    const providedReg = String(regNumber || '').trim();
    doc.regNumber = providedReg || (await nextRegNumber());

    let member;
    for (let attempt = 0; ; attempt++) {
      try {
        member = await Member.create(doc);
        break;
      } catch (err) {
        // Retry only when the auto-generated regNumber collided
        if (err.code === 11000 && err.keyValue?.regNumber && !providedReg && attempt < 3) {
          doc.regNumber = await nextRegNumber();
          continue;
        }
        throw err;
      }
    }

    await logAudit({
      action: 'create',
      entityType: 'Member',
      entityId: member._id,
      performedBy: req.user._id,
      after: snapshot(member),
    });
    res.status(201).json({ member });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/members/:id
async function updateMember(req, res, next) {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    const before = snapshot(member);

    const { name, phone, regNumber, notes, active } = req.body || {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ message: 'Name cannot be empty' });
      member.name = String(name).trim();
    }
    if (phone !== undefined) {
      const normalized = normalizePhone(String(phone));
      if (!normalized) {
        return res.status(400).json({ message: 'Enter a valid phone number (e.g. 0712 345 678)' });
      }
      member.phone = normalized;
    }
    if (regNumber !== undefined) member.regNumber = String(regNumber).trim() || undefined;
    if (notes !== undefined) member.notes = String(notes).trim();
    if (active !== undefined) member.active = Boolean(active);

    await member.save();
    await logAudit({
      action: 'update',
      entityType: 'Member',
      entityId: member._id,
      performedBy: req.user._id,
      before,
      after: snapshot(member),
    });
    res.json({ member });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/members/:id — soft delete only, contributions are kept
async function deleteMember(req, res, next) {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    const before = snapshot(member);

    member.active = false;
    await member.save();
    await logAudit({
      action: 'delete',
      entityType: 'Member',
      entityId: member._id,
      performedBy: req.user._id,
      before,
      after: snapshot(member),
    });
    res.json({ member });
  } catch (err) {
    next(err);
  }
}

// POST /api/members/import — body: { csv: "name,phone,..." }
async function importMembers(req, res, next) {
  try {
    const csv = req.body?.csv;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ message: 'CSV content is required' });
    }

    let rows;
    try {
      rows = parseMembersCSV(csv);
    } catch (err) {
      return res.status(400).json({ message: `Could not read CSV: ${err.message}` });
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const { rowNumber, name, phone, regNumber, notes } of rows) {
      if (!name) {
        skipped++;
        errors.push({ row: rowNumber, reason: 'Missing name' });
        continue;
      }
      const normalized = normalizePhone(phone || '');
      if (!normalized) {
        skipped++;
        errors.push({ row: rowNumber, reason: `Invalid phone "${phone || ''}"` });
        continue;
      }
      const existing = await Member.findOne({ phone: normalized }).select('_id');
      if (existing) {
        skipped++;
        errors.push({ row: rowNumber, reason: `Duplicate phone ${normalized} — already registered` });
        continue;
      }
      try {
        const member = await Member.create({
          name,
          phone: normalized,
          regNumber: regNumber || (await nextRegNumber()),
          notes: notes || '',
          createdBy: req.user._id,
        });
        await logAudit({
          action: 'create',
          entityType: 'Member',
          entityId: member._id,
          performedBy: req.user._id,
          after: snapshot(member),
        });
        imported++;
      } catch (err) {
        skipped++;
        errors.push({
          row: rowNumber,
          reason: err.code === 11000 ? 'Duplicate registration number' : err.message,
        });
      }
    }

    res.json({ imported, skipped, errors });
  } catch (err) {
    next(err);
  }
}

// GET /api/members/export — CSV download
async function exportMembers(req, res, next) {
  try {
    const members = await Member.find().sort({ name: 1 }).lean();
    const ids = members.map((m) => m._id);
    const sums = await Contribution.aggregate([
      { $match: { memberId: { $in: ids }, deleted: false } },
      { $group: { _id: '$memberId', total: { $sum: '$amount' } } },
    ]);
    const sumMap = new Map(sums.map((s) => [String(s._id), s.total]));

    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [['name', 'phone', 'regNumber', 'totalContributed', 'status', 'notes'].join(',')];
    for (const m of members) {
      lines.push(
        [
          esc(m.name),
          esc(m.phone),
          esc(m.regNumber || ''),
          sumMap.get(String(m._id)) || 0,
          m.active ? 'active' : 'inactive',
          esc(m.notes || ''),
        ].join(',')
      );
    }

    // BOM so Excel detects UTF-8
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="members.csv"');
    res.send('﻿' + lines.join('\r\n'));
  } catch (err) {
    next(err);
  }
}

// Shared shape for every public-facing member view (phone lookup, directory
// detail). Never includes loggedBy, internal ids, or admin metadata.
async function buildPublicProfile(member) {
  const [docs, breakdown] = await Promise.all([
    Contribution.find({ memberId: member._id, deleted: false })
      .sort({ date: 1, createdAt: 1 })
      .populate('typeId', 'name')
      .lean(),
    typeBreakdown(member._id),
  ]);

  let running = 0;
  const contributions = docs.map((c) => {
    running += c.amount;
    return {
      amount: c.amount,
      date: c.date,
      method: c.method,
      type: c.typeId?.name || null,
      runningBalance: running,
    };
  });

  const totalPledged = breakdown.reduce((sum, b) => sum + b.pledged, 0);

  return {
    name: member.name,
    regNumber: member.regNumber || null,
    totalContributed: running,
    totalPledged,
    byType: breakdown.map((b) => ({
      type: b.name,
      pledged: b.pledged,
      contributed: b.contributed,
    })),
    contributions,
  };
}

// GET /api/public/lookup?phone= — PUBLIC, rate-limited, EXACT match only.
async function publicLookup(req, res, next) {
  try {
    const normalized = normalizePhone(String(req.query.phone || ''));
    if (!normalized) {
      return res.status(400).json({ message: 'Enter a valid phone number (e.g. 0712 345 678)' });
    }

    // Exact match enforced at query level — no regex, no partial search, single result.
    const member = await Member.findOne({ phone: normalized, active: true }).lean();
    if (!member) {
      return res.status(404).json({ message: 'not_found' });
    }

    res.json(await buildPublicProfile(member));
  } catch (err) {
    next(err);
  }
}

// Keeps first 2 and last 3 digits, masks the rest. Phone is always the fixed
// 10-char normalized format (0[17]XXXXXXXX), so slicing at fixed offsets is safe.
function maskPhone(phone) {
  return `${phone.slice(0, 2)}XX XXX ${phone.slice(7)}`;
}

// GET /api/public/directory?search=&page=&limit= — PUBLIC, open member list.
// The group chose full transparency over a bank-style private ledger — this
// deliberately lists every active member. Phone numbers are masked server-side
// so the response itself never carries a scrapeable full number.
async function publicDirectory(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const search = String(req.query.search || '').trim();

    const filter = { active: true };
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: rx }, { regNumber: rx }];
    }

    const [members, total] = await Promise.all([
      Member.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Member.countDocuments(filter),
    ]);

    const ids = members.map((m) => m._id);
    const sums = await Contribution.aggregate([
      { $match: { memberId: { $in: ids }, deleted: false } },
      {
        $group: {
          _id: '$memberId',
          total: { $sum: '$amount' },
          lastContributionDate: { $max: '$date' },
        },
      },
    ]);
    const sumMap = new Map(sums.map((s) => [String(s._id), s]));

    res.json({
      members: members.map((m) => ({
        id: m._id,
        name: m.name,
        regNumber: m.regNumber || null,
        phoneMasked: maskPhone(m.phone),
        totalContributed: sumMap.get(String(m._id))?.total || 0,
        lastContributionDate: sumMap.get(String(m._id))?.lastContributionDate || null,
      })),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/public/directory/:id — PUBLIC full passbook for one member, reached
// by browsing the directory rather than typing a phone number.
async function publicMemberProfile(req, res, next) {
  try {
    const member = await Member.findOne({ _id: req.params.id, active: true }).lean();
    if (!member) {
      return res.status(404).json({ message: 'not_found' });
    }
    res.json(await buildPublicProfile(member));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMembers,
  getMember,
  createMember,
  updateMember,
  deleteMember,
  importMembers,
  exportMembers,
  publicLookup,
  publicDirectory,
  publicMemberProfile,
};
