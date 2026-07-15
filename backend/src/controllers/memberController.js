const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const Fine = require('../models/Fine');
const ContributionType = require('../models/ContributionType');
const Counter = require('../models/Counter');
const { normalizePhone } = require('../utils/phone');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { parseMembersCSV } = require('../utils/csvImport');
const { typeBreakdown } = require('../utils/typeBreakdown');
const { buildWeeklySchedule } = require('../utils/weeklySchedule');
const { nonPersonalTypeIds } = require('../utils/personalTypes');
const { renderStatementPdf } = require('../utils/statementPdf');
const { getOrCreateSettings } = require('../utils/settings');
const { sendWorkbook } = require('../utils/xlsxExport');

// Shared by both the admin member view and the public passbook: pending/settled
// fines for a member, and the week-by-week due schedule for every isWeekly
// contribution type, anchored to this member's own joinDate.
async function buildFinesAndSchedules(member, contributions) {
  const [pending, settled, weeklyTypes] = await Promise.all([
    Fine.find({ memberId: member._id, deleted: false, remaining: { $gt: 0 } })
      .sort({ date: 1 })
      .populate('typeId', 'name')
      .lean(),
    Fine.find({ memberId: member._id, deleted: false, remaining: { $lte: 0 } })
      .sort({ date: -1 })
      .populate('typeId', 'name')
      .lean(),
    ContributionType.find({ isWeekly: true, active: true }).lean(),
  ]);

  const totalOwed = pending.reduce((sum, f) => sum + f.remaining, 0);
  const weeklySchedules = weeklyTypes.map((type) => {
    const typeContributions = contributions.filter(
      (c) => String(c.typeId?._id || c.typeId) === String(type._id)
    );
    return {
      typeId: type._id,
      typeName: type.name,
      weeklyAmount: type.weeklyAmount,
      weeks: buildWeeklySchedule(member.joinDate, type.weeklyAmount, typeContributions),
    };
  });

  return { fines: { pending, settled, totalOwed }, weeklySchedules };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const REG_COUNTER_NAME = 'memberRegNumber';

// Sequential reg numbers: CM-0001, CM-0002, ... backed by an atomic counter
// so concurrent signups can never compute the same "next" number. On first
// use the counter is seeded from the highest existing CM-#### regNumber
// (numeric comparison — a lexicographic sort would treat "CM-10000" as
// smaller than "CM-9999").
async function nextRegNumber() {
  let counter = await Counter.findOne({ name: REG_COUNTER_NAME });
  if (!counter) {
    const existing = await Member.find({ regNumber: /^CM-\d+$/ }).select('regNumber').lean();
    const seed = existing.reduce((max, m) => {
      const n = parseInt(m.regNumber.slice(3), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    try {
      counter = await Counter.create({ name: REG_COUNTER_NAME, value: seed });
    } catch (err) {
      if (err.code !== 11000) throw err; // lost the bootstrap race — fine, fall through
    }
  }
  const updated = await Counter.findOneAndUpdate(
    { name: REG_COUNTER_NAME },
    { $inc: { value: 1 } },
    { upsert: true, new: true }
  );
  return `CM-${String(updated.value).padStart(4, '0')}`;
}

// GET /api/members?search=&status=&page=&limit=
async function listMembers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    // Higher ceiling than other list endpoints: the admin weekly logging grid
    // needs every active member in one request to render its rows.
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 20));
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

    // Per-member totals (personal types only — group funds like Chai belong to
    // the group, not the individual, so they must not inflate this figure)
    // + last contribution date of any kind, for the card list.
    const ids = members.map((m) => m._id);
    const excludedTypeIds = await nonPersonalTypeIds();
    const [personalSums, lastDates] = await Promise.all([
      Contribution.aggregate([
        { $match: { memberId: { $in: ids }, deleted: false, typeId: { $nin: excludedTypeIds } } },
        { $group: { _id: '$memberId', totalContributed: { $sum: '$amount' } } },
      ]),
      Contribution.aggregate([
        { $match: { memberId: { $in: ids }, deleted: false } },
        { $group: { _id: '$memberId', lastContributionDate: { $max: '$date' } } },
      ]),
    ]);
    const sumMap = new Map(personalSums.map((s) => [String(s._id), s]));
    const lastDateMap = new Map(lastDates.map((s) => [String(s._id), s.lastContributionDate]));

    res.json({
      members: members.map((m) => ({
        ...m,
        totalContributed: sumMap.get(String(m._id))?.totalContributed || 0,
        lastContributionDate: lastDateMap.get(String(m._id)) || null,
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
        .populate('typeId', 'name isGroupFund')
        .lean(),
      typeBreakdown(member._id),
    ]);
    // Group-fund types (e.g. Chai) are still shown on the ledger but excluded
    // from the personal total — that money belongs to the group, not them.
    const totalContributed = contributions
      .filter((c) => !c.typeId?.isGroupFund)
      .reduce((sum, c) => sum + c.amount, 0);
    const totalPledged = byType.reduce((sum, b) => sum + b.pledged, 0);
    const { fines, weeklySchedules } = await buildFinesAndSchedules(member, contributions);

    res.json({ member, contributions, totalContributed, totalPledged, byType, fines, weeklySchedules });
  } catch (err) {
    next(err);
  }
}

// POST /api/members
async function createMember(req, res, next) {
  try {
    const { name, phone, email, regNumber, notes, joinDate } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }
    const normalized = normalizePhone(String(phone || ''));
    if (!normalized) {
      return res.status(400).json({ message: 'Enter a valid phone number (e.g. 0712 345 678)' });
    }
    const trimmedEmail = String(email || '').trim();
    if (trimmedEmail && !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }

    const doc = {
      name: String(name).trim(),
      phone: normalized,
      email: trimmedEmail,
      notes: String(notes || '').trim(),
      createdBy: req.user._id,
    };
    if (joinDate) {
      const d = new Date(joinDate);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid join date' });
      doc.joinDate = d;
    }
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

    const { name, phone, email, regNumber, notes, active, joinDate } = req.body || {};
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
    if (email !== undefined) {
      const trimmedEmail = String(email).trim();
      if (trimmedEmail && !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
        return res.status(400).json({ message: 'Enter a valid email address' });
      }
      member.email = trimmedEmail;
    }
    if (regNumber !== undefined) member.regNumber = String(regNumber).trim() || undefined;
    if (notes !== undefined) member.notes = String(notes).trim();
    if (joinDate !== undefined && joinDate !== null && joinDate !== '') {
      const d = new Date(joinDate);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid join date' });
      member.joinDate = d;
    }
    if (active !== undefined) {
      member.active = Boolean(active);
      // Reactivating clears the resignation record — they're a current member again.
      if (member.active) {
        member.resignedAt = null;
        member.resignationReason = '';
      }
    }

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

// POST /api/members/:id/resign — explicit resignation, distinct from a plain
// deactivation: records when and why, and is what the public resigned list is
// keyed on.
async function resignMember(req, res, next) {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    if (!member.active) return res.status(400).json({ message: 'Member is already inactive' });
    const before = snapshot(member);

    member.active = false;
    member.resignedAt = new Date();
    member.resignationReason = String(req.body?.reason || '').trim();
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

const CSV_IMPORT_ROW_LIMIT = 1000;

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
    if (rows.length > CSV_IMPORT_ROW_LIMIT) {
      return res.status(400).json({
        message: `That file has ${rows.length} rows — please split it into batches of ${CSV_IMPORT_ROW_LIMIT} or fewer.`,
      });
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

// GET /api/members/export — .xlsx workbook download
async function exportMembers(req, res, next) {
  try {
    const members = await Member.find().sort({ name: 1 }).lean();
    const ids = members.map((m) => m._id);
    const excludedTypeIds = await nonPersonalTypeIds();
    const sums = await Contribution.aggregate([
      { $match: { memberId: { $in: ids }, deleted: false, typeId: { $nin: excludedTypeIds } } },
      { $group: { _id: '$memberId', total: { $sum: '$amount' } } },
    ]);
    const sumMap = new Map(sums.map((s) => [String(s._id), s.total]));

    const sheetRows = members.map((m) => ({
      Name: m.name,
      Phone: m.phone,
      Email: m.email || '',
      'Reg number': m.regNumber || '',
      'Total contributed': sumMap.get(String(m._id)) || 0,
      Status: m.active ? 'active' : 'inactive',
      Notes: m.notes || '',
    }));
    sendWorkbook(res, 'members.xlsx', [{ name: 'Members', rows: sheetRows }]);
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
      .populate('typeId', 'name isGroupFund')
      .lean(),
    typeBreakdown(member._id),
  ]);

  // Group-fund contributions (e.g. Chai) still show up as their own ledger
  // row, but don't add to the running personal balance — that money belongs
  // to the group, not the individual.
  let running = 0;
  const contributions = docs.map((c) => {
    if (!c.typeId?.isGroupFund) running += c.amount;
    return {
      amount: c.amount,
      grossAmount: c.grossAmount,
      fineDeducted: c.fineDeducted || 0,
      date: c.date,
      method: c.method,
      type: c.typeId?.name || null,
      isGroupFund: !!c.typeId?.isGroupFund,
      runningBalance: running,
    };
  });

  const totalPledged = breakdown.reduce((sum, b) => sum + b.pledged, 0);
  const { fines, weeklySchedules } = await buildFinesAndSchedules(member, docs);
  // Strip admin-only fields (who issued it, which contribution settled it)
  // before this reaches the public passbook.
  const publicFine = (f) => ({
    type: f.typeId?.name || null,
    amount: f.amount,
    remaining: f.remaining,
    reason: f.reason,
    date: f.date,
  });
  const publicFines = {
    pending: fines.pending.map(publicFine),
    settled: fines.settled.map(publicFine),
    totalOwed: fines.totalOwed,
  };

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
    fines: publicFines,
    weeklySchedules,
  };
}

// Renders a buildPublicProfile() result as a downloadable PDF statement — a
// spreadsheet isn't a great fit for someone checking their own record on a
// phone; PDF opens/prints cleanly everywhere.
async function sendStatement(res, profile) {
  const settings = await getOrCreateSettings();
  renderStatementPdf(res, profile, settings.chamaName);
}

// GET /api/public/lookup/statement?phone= — PUBLIC, same access rule as publicLookup.
async function publicLookupStatement(req, res, next) {
  try {
    const normalized = normalizePhone(String(req.query.phone || ''));
    if (!normalized) {
      return res.status(400).json({ message: 'Enter a valid phone number (e.g. 0712 345 678)' });
    }
    const member = await Member.findOne({ phone: normalized, active: true }).lean();
    if (!member) return res.status(404).json({ message: 'not_found' });
    await sendStatement(res, await buildPublicProfile(member));
  } catch (err) {
    next(err);
  }
}

// GET /api/public/directory/:id/statement — PUBLIC, same access rule as publicMemberProfile.
async function publicMemberStatement(req, res, next) {
  try {
    const member = await Member.findOne({ _id: req.params.id, active: true }).lean();
    if (!member) return res.status(404).json({ message: 'not_found' });
    await sendStatement(res, await buildPublicProfile(member));
  } catch (err) {
    next(err);
  }
}

// GET /api/members/:id/statement — admin, any member regardless of active status.
async function memberStatement(req, res, next) {
  try {
    const member = await Member.findById(req.params.id).lean();
    if (!member) return res.status(404).json({ message: 'Member not found' });
    await sendStatement(res, await buildPublicProfile(member));
  } catch (err) {
    next(err);
  }
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
    const excludedTypeIds = await nonPersonalTypeIds();
    const [personalSums, lastDates] = await Promise.all([
      Contribution.aggregate([
        { $match: { memberId: { $in: ids }, deleted: false, typeId: { $nin: excludedTypeIds } } },
        { $group: { _id: '$memberId', total: { $sum: '$amount' } } },
      ]),
      Contribution.aggregate([
        { $match: { memberId: { $in: ids }, deleted: false } },
        { $group: { _id: '$memberId', lastContributionDate: { $max: '$date' } } },
      ]),
    ]);
    const sumMap = new Map(personalSums.map((s) => [String(s._id), s.total]));
    const lastDateMap = new Map(lastDates.map((s) => [String(s._id), s.lastContributionDate]));

    res.json({
      members: members.map((m) => ({
        id: m._id,
        name: m.name,
        regNumber: m.regNumber || null,
        phoneMasked: maskPhone(m.phone),
        totalContributed: sumMap.get(String(m._id)) || 0,
        lastContributionDate: lastDateMap.get(String(m._id)) || null,
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

// GET /api/public/resigned?search=&page=&limit= — PUBLIC list of members who
// explicitly resigned (resignedAt set), separate from the current directory.
// Same full-transparency choice as publicDirectory.
async function publicResigned(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const search = String(req.query.search || '').trim();

    const filter = { active: false, resignedAt: { $ne: null } };
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: rx }, { regNumber: rx }];
    }

    const [members, total] = await Promise.all([
      Member.find(filter).sort({ resignedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Member.countDocuments(filter),
    ]);

    res.json({
      members: members.map((m) => ({
        name: m.name,
        regNumber: m.regNumber || null,
        resignedAt: m.resignedAt,
        resignationReason: m.resignationReason || '',
      })),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
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
  resignMember,
  importMembers,
  exportMembers,
  memberStatement,
  publicLookup,
  publicLookupStatement,
  publicDirectory,
  publicMemberProfile,
  publicMemberStatement,
  publicResigned,
};
