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
const { resolveConfig, cycleHistory } = require('../utils/weekCycle');
const { bucketForType } = require('../utils/ledgerTypes');
const { computeMemberLedger } = require('../utils/memberLedger');
const { nonPersonalTypeIds } = require('../utils/personalTypes');
const { renderStatementPdf } = require('../utils/statementPdf');
const { getOrCreateSettings } = require('../utils/settings');
const { sendWorkbook } = require('../utils/xlsxExport');
const { cleanEmail, isValidEmail } = require('../utils/mailer');
const { destroyImage } = require('../utils/cloudinary');

// Next of kin arrives as a nested object from the member form. Every field is
// optional, and sending the fields empty is how an admin clears a stale contact.
function cleanNextOfKin(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    name: String(source.name || '').trim(),
    relationship: String(source.relationship || '').trim(),
    phone: String(source.phone || '').trim(),
    email: cleanEmail(source.email),
  };
}

// Returns an error message, or null when the contact is usable. A name with no
// way to reach anyone is the one combination worth rejecting: in the emergency
// this field exists for, it would be useless.
function nextOfKinError(kin) {
  const empty = !kin.name && !kin.phone && !kin.email;
  if (empty) return null;
  if (!kin.name) return 'Next of kin needs a name';
  if (kin.phone && !/^[+\d][\d\s\-()]{6,}$/.test(kin.phone)) {
    return 'Enter a valid next of kin phone number';
  }
  if (!isValidEmail(kin.email)) return 'Enter a valid next of kin email address';
  if (!kin.phone && !kin.email) return 'Add a phone number or an email for the next of kin';
  return null;
}

// Shared by both the admin member view and the public passbook: pending/settled
// fines for a member, and the week-by-week due schedule for every weekly fund,
// taken from the group cycle (see buildWeeklySchedule) so the passbook always
// shows the same week number and the same 1,400 the treasurer is working to.
// `settings` is optional: a caller that has already loaded it passes it in, which
// is one round trip fewer on the public passbook — the screen a member opens
// most often, usually on a phone on mobile data.
async function buildFinesAndSchedules(member, contributions, settings) {
  const [pending, settled, weeklyTypes, loadedSettings] = await Promise.all([
    Fine.find({ memberId: member._id, deleted: false, remaining: { $gt: 0 } })
      .sort({ date: 1 })
      .populate('typeId', 'name')
      .lean(),
    Fine.find({ memberId: member._id, deleted: false, remaining: { $lte: 0 } })
      .sort({ date: -1 })
      .populate('typeId', 'name')
      .lean(),
    ContributionType.find({ isWeekly: true, active: true }).lean(),
    settings ? Promise.resolve(settings) : getOrCreateSettings(),
  ]);

  const config = resolveConfig(loadedSettings);
  const totalOwed = pending.reduce((sum, f) => sum + f.remaining, 0);
  const weeklySchedules = weeklyTypes.map((type) => {
    const typeContributions = contributions.filter(
      (c) => String(c.typeId?._id || c.typeId) === String(type._id)
    );
    // The cycle's own amount wins over the type copy: Settings is authoritative
    // (constitution §7.1, §7.2) and the two are only kept in step for the older
    // screens that still read the type's own weeklyAmount.
    const isChai = bucketForType(type) === 'chai';
    const amount = isChai ? config.chaiAmount : config.weeklyAmount;
    const weeks = buildWeeklySchedule(config, amount, typeContributions);
    return {
      typeId: type._id,
      typeName: type.name,
      weeklyAmount: amount,
      // Tea is automatic: every week is collected from every member by
      // deduction, so a tea week is never unpaid and is never something a member
      // owes. Shown so each member can see what has gone into the Group's fund.
      automatic: isChai,
      weeks: isChai
        ? weeks.map((w) => ({ ...w, paid: amount, status: 'paid' }))
        : weeks,
      // The group's earlier weeks (1..91 today), so the schedule reads back to
      // week one exactly as the paper ledger numbered it. They are marked
      // isHistory and carry no expectation — the money for them is inside the
      // member's carried-forward balance.
      history: cycleHistory(config),
    };
  });

  return { fines: { pending, settled, totalOwed }, weeklySchedules };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The single pass that turns raw contribution rows into what the cycle engine
// needs: every row tagged with its bucket (weekly / chai / other) and grouped per
// member, plus the two figures the member lists show next to the balance — what
// he has paid personally, and when he last paid.
//
// Shared by the admin member list and the public directory on purpose. Both score
// a member's money with the same engine, so the treasurer's ledger and the open
// directory can never disagree about the same person.
function summariseContributionRows(rows, types) {
  const typeById = new Map(types.map((t) => [String(t._id), t]));
  const byMemberId = new Map();
  const personalTotals = new Map();
  const lastDates = new Map();

  for (const row of rows) {
    const type = typeById.get(String(row.typeId));
    const isGroupFund = Boolean(type && type.isGroupFund);
    const key = String(row.memberId);

    if (!byMemberId.has(key)) byMemberId.set(key, []);
    byMemberId.get(key).push({ ...row, bucket: bucketForType(type), isGroupFund });

    // Group-fund money (tea) belongs to the Group, so it never counts toward what
    // the member personally paid. grossAmount is preferred so a payment partly
    // redirected to settle a fine still counts as cash received.
    const cash = Number(row.grossAmount ?? row.amount) || 0;
    if (!isGroupFund) personalTotals.set(key, (personalTotals.get(key) || 0) + cash);

    const at = new Date(row.date).getTime();
    if (!lastDates.has(key) || at > lastDates.get(key)) lastDates.set(key, at);
  }

  return { byMemberId, personalTotals, lastDates };
}

// Every row the members on screen need, annotated, alongside the types they hang
// off — one pair of queries whatever the list is for.
async function loadContributionRows(memberIds) {
  const [rows, types] = await Promise.all([
    Contribution.find({ memberId: { $in: memberIds }, deleted: false })
      .select('memberId typeId amount grossAmount date')
      .lean(),
    ContributionType.find().select('name isWeekly isGroupFund active').lean(),
  ]);
  return summariseContributionRows(rows, types);
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

    // Everything the cards show — what he has paid, when, and his balance — comes
    // from the rows this page needs plus the group cycle, so the two per-member
    // aggregations that used to run alongside it are gone.
    const { byMemberId, personalTotals, lastDates } = await loadContributionRows(
      members.map((m) => m._id)
    );

    const settings = await getOrCreateSettings();
    const config = resolveConfig(settings);

    res.json({
      members: members.map((m) => {
        // The money a member actually holds comes from the same cycle engine the
        // finance ledger uses — openingBalance plus what he has paid since the
        // cycle opened, less the week's requirement and that week's tea. Summing
        // contribution rows alone would report every member as holding nothing,
        // because the money carried across from the paper ledger lives in
        // openingBalance, not in rows.
        const ledger = computeMemberLedger({
          member: m,
          contributions: byMemberId.get(String(m._id)) || [],
          config,
        });
        return {
          ...m,
          totalContributed: personalTotals.get(String(m._id)) || 0,
          lastContributionDate: lastDates.has(String(m._id))
            ? new Date(lastDates.get(String(m._id)))
            : null,
          balance: ledger.money,
          arrears: ledger.arrears,
          weeksBehind: ledger.weeksBehind,
          chaiDue: ledger.chai.due,
        };
      }),
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
    const { name, phone, email, regNumber, notes, joinDate, photoUrl, photoPublicId, nextOfKin, emailNotifications } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }
    const normalized = normalizePhone(String(phone || ''));
    if (!normalized) {
      return res.status(400).json({ message: 'Enter a valid phone number (e.g. 0712 345 678)' });
    }
    const trimmedEmail = cleanEmail(email);
    if (!isValidEmail(trimmedEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    const kin = cleanNextOfKin(nextOfKin);
    const kinError = nextOfKinError(kin);
    if (kinError) return res.status(400).json({ message: kinError });

    const doc = {
      name: String(name).trim(),
      phone: normalized,
      email: trimmedEmail,
      photoUrl: String(photoUrl || '').trim(),
      photoPublicId: String(photoPublicId || '').trim(),
      nextOfKin: kin,
      emailNotifications: emailNotifications === undefined ? true : Boolean(emailNotifications),
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

    const { name, phone, email, regNumber, notes, active, joinDate, photoUrl, photoPublicId, nextOfKin, emailNotifications } = req.body || {};
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
      const trimmedEmail = cleanEmail(email);
      if (!isValidEmail(trimmedEmail)) {
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
    if (emailNotifications !== undefined) {
      member.emailNotifications = Boolean(emailNotifications);
    }
    if (nextOfKin !== undefined) {
      const kin = cleanNextOfKin(nextOfKin);
      const kinError = nextOfKinError(kin);
      if (kinError) return res.status(400).json({ message: kinError });
      member.nextOfKin = kin;
    }

    // A replaced photo takes its Cloudinary asset with it. The old publicId is
    // only remembered here and destroyed after a successful save, so a failed
    // update can never leave a member with neither their old photo nor the new one.
    const replacedPhotoId =
      photoPublicId !== undefined &&
      member.photoPublicId &&
      member.photoPublicId !== String(photoPublicId).trim()
        ? member.photoPublicId
        : null;

    // URL and publicId travel as a pair — receiving only one of them would mean
    // storing an image nothing can ever delete again.
    if (photoPublicId !== undefined || photoUrl !== undefined) {
      member.photoUrl = String(photoUrl || '').trim();
      member.photoPublicId = String(photoPublicId || '').trim();
    }

    await member.save();
    if (replacedPhotoId) await destroyImage(replacedPhotoId);
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

    for (const { rowNumber, name, phone, email, regNumber, notes } of rows) {
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
      const rowEmail = cleanEmail(email);
      if (!isValidEmail(rowEmail)) {
        skipped++;
        errors.push({ row: rowNumber, reason: `Invalid email "${email}"` });
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
          email: rowEmail,
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

// GET /api/members/import-template — blank .xlsx with the exact columns
// importMembers reads, plus one filled example row so the format is obvious.
async function importTemplate(req, res, next) {
  try {
    const sheetRows = [
      {
        name: 'Jane Wanjiru',
        phone: '0712345678',
        email: 'jane@example.com',
        regNumber: '',
        notes: 'Optional note',
      },
      { name: '', phone: '', email: '', regNumber: '', notes: '' },
    ];
    sendWorkbook(res, 'members-import-template.xlsx', [{ name: 'Members', rows: sheetRows }]);
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
// Renders the public-facing passbook for one member. The returned object is
// also reused as the body of the phone-gated PDF/Excel statements, so it is
// deliberately kept lean: no audit trail, no "issued by" fields.
//
// `lookupPhone` is the number the caller entered at the gate. When it matches
// the member's own number we let the member see their own contact details
// (email + next of kin) — otherwise those stay hidden, the same way the
// full phone number is never echoed back even to the member.
async function buildPublicProfile(member, lookupPhone) {
  const callerIsSelf = lookupPhone && normalizePhone(lookupPhone) === normalizePhone(member.phone);
  const [docs, breakdown, settings] = await Promise.all([
    Contribution.find({ memberId: member._id, deleted: false })
      .sort({ date: 1, createdAt: 1 })
      .populate('typeId', 'name isGroupFund')
      .lean(),
    typeBreakdown(member._id),
    getOrCreateSettings(),
  ]);
  const config = resolveConfig(settings);

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
  const { fines, weeklySchedules } = await buildFinesAndSchedules(member, docs, settings);

  // The cycle position, from the one engine the treasurer's ledger, the member
  // list and the reminders all read. "Total contributed" alone reads as 0 once
  // the paper ledger's money has been carried into openingBalance, so what a
  // member holds has to come from here — otherwise his own passbook says he has
  // nothing while the office sees 123,400 against his name.
  const ledger = computeMemberLedger({
    member,
    contributions: docs.map((c) => ({
      ...c,
      bucket: bucketForType(c.typeId),
      isGroupFund: Boolean(c.typeId && c.typeId.isGroupFund),
    })),
    config,
  });
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
    // Public: the directory is open by design, so a profile photo is fine here.
    photoUrl: member.photoUrl || '',
    // Masked the same way the directory masks it — a member's own number is
    // never echoed back in full, even to themselves, so a shared screen or a
    // screenshot can't leak it.
    phoneMasked: maskPhone(member.phone),
    joinDate: member.joinDate || member.createdAt || null,
    contributionsCount: contributions.length,
    finesSettledCount: fines.settled.length,
    // Logged rows only: what he has paid since the cycle opened, tea excluded.
    // Kept because the statement exports still print it as its own line, but the
    // figure that answers "what does he hold?" is `ledger.money` below.
    totalContributed: running,
    totalPledged,
    // What the member actually holds, and the four figures it is made of, so the
    // passbook can show its work exactly as the treasurer's page does.
    ledger: {
      currentWeek: ledger.currentWeek,
      cycleStartWeek: config.cycleStartWeek,
      weeklyAmount: ledger.weeklyAmount,
      chaiAmount: ledger.chaiAmount,
      openingBalance: ledger.openingBalance,
      paid: ledger.paid,
      required: ledger.required,
      tea: ledger.chai.due,
      money: ledger.money,
      arrears: ledger.arrears,
      credit: ledger.credit,
      weeksElapsed: ledger.weeksElapsed,
      weeksPaid: ledger.weeksPaid,
      weeksBehind: ledger.weeksBehind,
    },
    byType: breakdown.map((b) => ({
      type: b.name,
      pledged: b.pledged,
      contributed: b.contributed,
    })),
    contributions,
    fines: publicFines,
    weeklySchedules,
    // When the caller proved their own number at the gate, the member gets to
    // see their own contact details back. Strangers (or someone looking up a
    // friend) never see email or next of kin — one of each of those is
    // personal and one is someone else's contact.
    ...(callerIsSelf && {
      email: member.email || '',
      nextOfKin: member.nextOfKin && Object.keys(member.nextOfKin).length
        ? { name: member.nextOfKin.name || '', relationship: member.nextOfKin.relationship || '', phone: member.nextOfKin.phone || '', email: member.nextOfKin.email || '' }
        : null,
      emailNotifications: member.emailNotifications,
    }),
  };
}

// Renders a buildPublicProfile() result as a downloadable PDF statement — a
// spreadsheet isn't a great fit for someone checking their own record on a
// phone; PDF opens/prints cleanly everywhere.
async function sendStatement(res, profile) {
  const settings = await getOrCreateSettings();
  renderStatementPdf(res, profile, settings.chamaName);
}
// Renders a member's statement as an Excel workbook.
async function sendStatementExcel(res, profile) {
  const settings = await getOrCreateSettings();

  const summaryRows = [
    {
      Field: 'Chama',
      Value: settings.chamaName || '',
    },
    {
      Field: 'Member Name',
      Value: profile.name || '',
    },
    {
      Field: 'Registration Number',
      Value: profile.regNumber || '',
    },
    {
      // The figure that answers "what does he hold?" — the same cycle maths the
      // ledger screen and the passbook show. Total contributed on its own is 0
      // for every member while the money carried forward sits in openingBalance.
      Field: 'Held by Member',
      Value: profile.ledger ? profile.ledger.money : profile.totalContributed || 0,
    },
    {
      Field: 'Carried Forward (opening balance)',
      Value: profile.ledger ? profile.ledger.openingBalance : 0,
    },
    {
      Field: 'Paid Since Cycle Opened',
      Value: profile.ledger ? profile.ledger.paid : profile.totalContributed || 0,
    },
    {
      Field: 'Required So Far',
      Value: profile.ledger ? profile.ledger.required : 0,
    },
    {
      Field: 'Tea (automatic)',
      Value: profile.ledger ? profile.ledger.tea : 0,
    },
    {
      Field: 'Total Pledged',
      Value: profile.totalPledged || 0,
    },
    {
      Field: 'Outstanding Fines',
      Value: profile.fines?.totalOwed || 0,
    },
    {
      Field: 'Generated On',
      Value: new Date(),
    },
  ];

  const contributionRows = (profile.contributions || []).map((c, index) => ({
    '#': index + 1,
    Date: c.date || '',
    'Contribution Type': c.type || '',
    Amount: c.amount || 0,
    'Payment Method': c.method || '',
    'Fine Deducted': c.fineDeducted || 0,
    'Gross Amount': c.grossAmount || c.amount || 0,
    'Group Fund': c.isGroupFund ? 'Yes' : 'No',
    'Paid to date': c.runningBalance || 0,
  }));

  const breakdownRows = (profile.byType || []).map((b) => ({
    'Contribution Type': b.type || '',
    Pledged: b.pledged || 0,
    Contributed: b.contributed || 0,
    Balance: Math.max((b.pledged || 0) - (b.contributed || 0), 0),
  }));

  const fineRows = [
    ...(profile.fines?.pending || []).map((f) => ({
      Date: f.date || '',
      Type: f.type || '',
      Amount: f.amount || 0,
      Remaining: f.remaining || 0,
      Reason: f.reason || '',
      Status: 'Pending',
    })),
    ...(profile.fines?.settled || []).map((f) => ({
      Date: f.date || '',
      Type: f.type || '',
      Amount: f.amount || 0,
      Remaining: f.remaining || 0,
      Reason: f.reason || '',
      Status: 'Settled',
    })),
  ];

  sendWorkbook(res, 'contribution-statement.xlsx', [
    {
      name: 'Summary',
      rows: summaryRows,
    },
    {
      name: 'Contribution History',
      rows: contributionRows,
    },
    {
      name: 'Contribution Breakdown',
      rows: breakdownRows,
    },
    {
      name: 'Fines',
      rows: fineRows,
    },
  ]);
}
// Renders a buildPublicProfile() result as a downloadable Excel statement.
async function sendStatementExcel(res, profile) {
  const settings = await getOrCreateSettings();

  const summaryRows = [
    { Field: 'Chama', Value: settings.chamaName || '' },
    { Field: 'Member Name', Value: profile.name || '' },
    { Field: 'Registration Number', Value: profile.regNumber || '' },
    { Field: 'Held by Member', Value: profile.ledger ? profile.ledger.money : profile.totalContributed || 0 },
    { Field: 'Carried Forward (opening balance)', Value: profile.ledger ? profile.ledger.openingBalance : 0 },
    { Field: 'Paid Since Cycle Opened', Value: profile.ledger ? profile.ledger.paid : profile.totalContributed || 0 },
    { Field: 'Required So Far', Value: profile.ledger ? profile.ledger.required : 0 },
    { Field: 'Tea (automatic)', Value: profile.ledger ? profile.ledger.tea : 0 },
    { Field: 'Total Pledged', Value: profile.totalPledged || 0 },
    { Field: 'Outstanding Fines', Value: profile.fines?.totalOwed || 0 },
    { Field: 'Generated On', Value: new Date() },
  ];

  const contributionRows = (profile.contributions || []).map((c, index) => ({
    '#': index + 1,
    Date: c.date || '',
    'Contribution Type': c.type || '',
    Amount: c.amount || 0,
    'Payment Method': c.method || '',
    'Fine Deducted': c.fineDeducted || 0,
    'Group Fund': c.isGroupFund ? 'Yes' : 'No',
    'Paid to date': c.runningBalance || 0,
  }));

  const breakdownRows = (profile.byType || []).map((b) => ({
    'Contribution Type': b.type || '',
    Pledged: b.pledged || 0,
    Contributed: b.contributed || 0,
    Balance: Math.max((b.pledged || 0) - (b.contributed || 0), 0),
  }));

  const pendingFineRows = (profile.fines?.pending || []).map((f) => ({
    Date: f.date || '',
    Type: f.type || '',
    Amount: f.amount || 0,
    Remaining: f.remaining || 0,
    Reason: f.reason || '',
    Status: 'Pending',
  }));

  const settledFineRows = (profile.fines?.settled || []).map((f) => ({
    Date: f.date || '',
    Type: f.type || '',
    Amount: f.amount || 0,
    Remaining: f.remaining || 0,
    Reason: f.reason || '',
    Status: 'Settled',
  }));

  const fineRows = [...pendingFineRows, ...settledFineRows];

  const weeklyRows = [];

  for (const schedule of profile.weeklySchedules || []) {
    for (const week of schedule.weeks || []) {
      weeklyRows.push({
        'Contribution Type': schedule.typeName || '',
        'Weekly Amount': schedule.weeklyAmount || 0,
        Week: week.week || '',
        Date: week.date || '',
        Due: week.due || 0,
        Contributed: week.contributed || 0,
        Balance: week.balance || 0,
        Status: week.status || '',
      });
    }
  }

  sendWorkbook(res, 'contribution-statement.xlsx', [
    {
      name: 'Summary',
      rows: summaryRows,
    },
    {
      name: 'Contribution History',
      rows: contributionRows,
    },
    {
      name: 'Contribution Breakdown',
      rows: breakdownRows,
    },
    {
      name: 'Fines',
      rows: fineRows,
    },
    {
      name: 'Weekly Schedule',
      rows: weeklyRows,
    },
  ]);
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
    await sendStatement(res, await buildPublicProfile(member, normalized));
  } catch (err) {
    next(err);
  }
}
// GET /api/public/lookup/statement/excel?phone= — PUBLIC
async function publicLookupStatementExcel(req, res, next) {
  try {
    const normalized = normalizePhone(String(req.query.phone || ''));

    if (!normalized) {
      return res.status(400).json({
        message: 'Enter a valid phone number (e.g. 0712 345 678)',
      });
    }

    const member = await Member.findOne({
      phone: normalized,
      active: true,
    }).lean();

    if (!member) {
      return res.status(404).json({ message: 'not_found' });
    }

    await sendStatementExcel(
      res,
      await buildPublicProfile(member, normalized)
    );
  } catch (err) {
    next(err);
  }
}

// GET /api/public/directory/:id/statement/excel — PUBLIC
async function publicMemberStatementExcel(req, res, next) {
  try {
    const member = await Member.findOne({
      _id: req.params.id,
      active: true,
    }).lean();

    if (!member) {
      return res.status(404).json({ message: 'not_found' });
    }

    await sendStatementExcel(
      res,
      await buildPublicProfile(member)
    );
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

    // The number that just matched IS the credential, so this caller is the
    // member: pass it through and they see their own email and next of kin.
    // Browsing the directory (no phone) keeps those two fields hidden.
    res.json(await buildPublicProfile(member, normalized));
  } catch (err) {
    next(err);
  }
}

// Keeps first 2 and last 3 digits, masks the rest. Phone is always the fixed
// 10-char normalized format (0[17]XXXXXXXX), so slicing at fixed offsets is safe.
function maskPhone(phone) {
  return `${phone.slice(0, 2)}XX XXX ${phone.slice(7)}`;
}

// GET /api/public/directory/:id/statement/excel — PUBLIC
async function publicMemberStatementExcel(req, res, next) {
  try {
    const member = await Member.findOne({
      _id: req.params.id,
      active: true,
    }).lean();

    if (!member) {
      return res.status(404).json({ message: 'not_found' });
    }

    await sendStatementExcel(
      res,
      await buildPublicProfile(member)
    );
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

    await sendStatementExcel(
      res,
      await buildPublicProfile(member)
    );
  } catch (err) {
    next(err);
  }
}

// GET /api/public/directory?search=&page=&limit= — PUBLIC, open member list.
// The group chose full transparency over a bank-style private ledger — this
// deliberately lists every active member. Phone numbers are masked server-side
// so the response itself never carries a scrapeable full number.
//
// The figure on each row is the member's money from the same cycle engine the
// treasurer's ledger and the admin member list use: openingBalance + what he has
// paid since the cycle opened − what the weeks have required − tea. Summing
// contribution rows alone — which is what this endpoint used to do — reports
// every member as holding nothing, because the money carried across from the
// paper ledger lives in openingBalance, not in rows.
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

    const { byMemberId, personalTotals, lastDates } = await loadContributionRows(
      members.map((m) => m._id)
    );
    const settings = await getOrCreateSettings();
    const config = resolveConfig(settings);

    res.json({
      members: members.map((m) => {
        const key = String(m._id);
        const ledger = computeMemberLedger({
          member: m,
          contributions: byMemberId.get(key) || [],
          config,
        });
        return {
          id: m._id,
          name: m.name,
          regNumber: m.regNumber || null,
          photoUrl: m.photoUrl || '',
          phoneMasked: maskPhone(m.phone),
          // What he holds, and what the cycle expects of him so far.
          balance: ledger.money,
          paid: ledger.paid,
          arrears: ledger.arrears,
          weeksBehind: ledger.weeksBehind,
          chaiPaid: ledger.chai.due,
          // Kept alongside `balance` for a caller that only has the old field:
          // what he has personally paid since the cycle opened, excluding tea.
          totalContributed: personalTotals.get(key) || 0,
          lastContributionDate: lastDates.has(key) ? new Date(lastDates.get(key)) : null,
        };
      }),
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
  importTemplate,
  exportMembers,
  memberStatement,
  memberStatementExcel,
  publicLookup,
  publicLookupStatement,
  publicLookupStatementExcel,
  publicDirectory,
  publicMemberProfile,
  publicMemberStatement,
  publicMemberStatementExcel,
  publicResigned,
};