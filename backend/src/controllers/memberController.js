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
const { resolveConfig, cycleHistory, weekNumberForDate } = require('../utils/weekCycle');
const { bucketForType } = require('../utils/ledgerTypes');
const { computeMemberLedger } = require('../utils/memberLedger');
const { nonPersonalTypeIds } = require('../utils/personalTypes');
const { renderMemberStatementPdf } = require('../utils/memberStatementPdf');
const { memberStatementSheets } = require('../utils/memberStatement');
const { getOrCreateSettings } = require('../utils/settings');
const { sendWorkbook } = require('../utils/xlsxExport');
const { cleanEmail, isValidEmail } = require('../utils/mailer');
const { destroyImage } = require('../utils/cloudinary');
const { nextOfKinList, nextOfKinListError } = require('../utils/nextOfKin');
const {
  APPROVAL_ROLES,
  APPROVAL_LABELS,
  cleanText,
  cleanFamily,
  normaliseFamily,
  cleanDateOfBirth,
  cleanCommitment,
  cleanApprovals,
  admissionStatus,
} = require('../utils/memberDetails');
const { decisionsForMember } = require('./constitutionController');

// Next of kin lives in utils/nextOfKin: the list, the legacy single-contact
// shape and the per-entry validation are shared with everything else that reads
// or writes a member's emergency contacts.

// The membership admission form's fields, cleaned in one place and validated once
// so creating a member and editing one can never store different shapes. A field
// the caller did not send comes back as `undefined`, which is how the update path
// knows to leave what is already on the record alone.
function detailsFromBody(body) {
  const dob = cleanDateOfBirth(body.dateOfBirth);
  if (dob.error) return { error: dob.error };
  return {
    dateOfBirth: dob.value,
    nationalId: cleanText(body.nationalId, 40),
    physicalAddress: cleanText(body.physicalAddress, 240),
    family: cleanFamily(body.family),
    commitment: cleanCommitment(body.commitment),
    approvals: cleanApprovals(body.approvals),
  };
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
    // Weeks before the cycle that were collected — the one-time week-91 entry —
    // carry their figures, so the schedule shows what was actually paid instead of
    // a dash for every week back to week one. They stay unscored: their money is
    // part of the member's brought-forward total.
    const historyPaidByWeek = new Map();
    for (const c of typeContributions) {
      const collected = weekNumberForDate(c.date, config);
      if (collected >= config.cycleStartWeek) continue;
      const cash = Number(c.grossAmount ?? c.amount) || 0;
      historyPaidByWeek.set(collected, (historyPaidByWeek.get(collected) || 0) + cash);
    }
    const history = cycleHistory(config).map((w) => ({
      ...w,
      paid: historyPaidByWeek.get(w.weekNumber) || 0,
    }));
    return {
      typeId: type._id,
      typeName: type.name,
      weeklyAmount: amount,
      // Which fund this is, so a member-facing screen can leave the Group's
      // automatic tea out while the office's ledger still shows it. Named for what
      // it is: the schedules list every weekly fund, and only this one is tea.
      isTeaFund: isChai,
      // Tea is automatic: every week is collected from every member by
      // deduction, so a tea week is never unpaid and is never something a member
      // owes. Shown so each member can see what has gone into the Group's fund.
      automatic: isChai,
      // Tea is automatic, so a tea week is never short and never something a
      // member owes — except the opening week, which takes no tea at all.
      weeks: isChai
        ? weeks.map((w) =>
            w.isBaseline
              ? { ...w, paid: 0, status: 'baseline' }
              : { ...w, paid: amount, status: 'paid' }
          )
        : weeks,
      // The group's earlier weeks (1..91 today), so the schedule reads back to
      // week one exactly as the paper ledger numbered it. They are marked
      // isHistory and carry no expectation — the money for them is inside the
      // member's carried-forward balance — but any that were collected carry the
      // amounts they were collected for.
      history,
    };
  });

  return { fines: { pending, settled, totalOwed }, weeklySchedules };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The single pass that turns raw contribution rows into what the cycle engine
// needs: every row tagged with its bucket (weekly / chai / other) and grouped per
// member, plus the two figures the member list shows next to the balance — what
// he has paid personally, and when he last paid.
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
          // Normalised for the same reason the profile endpoint does it: older
          // records hold a single contact object, newer ones a list.
          nextOfKin: nextOfKinList(m.nextOfKin),
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

    const [contributions, byType, settings] = await Promise.all([
      Contribution.find({ memberId: member._id, deleted: false })
        .sort({ date: -1, createdAt: -1 })
        .populate('loggedBy', 'name')
        .populate('typeId', 'name isGroupFund')
        .lean(),
      typeBreakdown(member._id),
      getOrCreateSettings(),
    ]);
    // Group-fund types (e.g. Chai) are still shown on the ledger but excluded
    // from the personal total — that money belongs to the group, not them.
    const totalContributed = contributions
      .filter((c) => !c.typeId?.isGroupFund)
      .reduce((sum, c) => sum + c.amount, 0);
    const config = resolveConfig(settings);
    const { fines, weeklySchedules } = await buildFinesAndSchedules(member, contributions, settings);

    // The same cycle figures the treasurer's ledger shows. A record page that
    // summed contribution rows instead would read "Ksh 0" for every member, since
    // the money carried across from the paper ledger lives in his opening balance.
    const ledger = computeMemberLedger({
      member,
      contributions: contributions.map((c) => ({
        ...c,
        bucket: bucketForType(c.typeId),
        isGroupFund: Boolean(c.typeId && c.typeId.isGroupFund),
      })),
      config,
    });

    res.json({
      // nextOfKin is normalised on the way out: records created before the list
      // existed still hold a single contact, and every reader (the form, the
      // profile, the passbook) expects a list.
      member: {
        ...member,
        nextOfKin: nextOfKinList(member.nextOfKin),
        // The admission form's fields in the shape the profile screen expects, even
        // for members added before the form existed.
        family: normaliseFamily(member.family),
        commitment: member.commitment || { agreed: false, agreedAt: null, signedBy: '' },
        approvals: member.approvals || [],
        admission: admissionStatus(member),
      },
      contributions,
      totalContributed,
      byType,
      fines,
      weeklySchedules,
      // What he decided on each chapter of the constitution, chapter by chapter,
      // exactly as his own reading page shows it.
      constitution: await decisionsForMember(member._id),
      ledger: {
        openingBalance: ledger.openingBalance,
        paid: ledger.paid,
        required: ledger.required,
        tea: ledger.chai.due,
        money: ledger.money,
        arrears: ledger.arrears,
        credit: ledger.credit,
        currentWeek: ledger.currentWeek,
        cycleStartWeek: config.cycleStartWeek,
        weeklyAmount: ledger.weeklyAmount,
        weeksScored: ledger.weeksScored,
        weeksBehind: ledger.weeksBehind,
      },
    });
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
    const kin = nextOfKinList(nextOfKin);
    const kinError = nextOfKinListError(kin);
    if (kinError) return res.status(400).json({ message: kinError });

    const details = detailsFromBody(req.body || {});
    if (details.error) return res.status(400).json({ message: details.error });

    const doc = {
      name: String(name).trim(),
      phone: normalized,
      email: trimmedEmail,
      photoUrl: String(photoUrl || '').trim(),
      photoPublicId: String(photoPublicId || '').trim(),
      nextOfKin: kin,
      dateOfBirth: details.dateOfBirth ?? null,
      nationalId: details.nationalId,
      physicalAddress: details.physicalAddress,
      family: details.family,
      commitment: details.commitment,
      approvals: details.approvals,
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
      // The whole list is replaced every time it is sent: that is how an admin
      // adds a second child or removes a contact who has died, without any
      // per-entry endpoints to keep in step with the form.
      const kin = nextOfKinList(nextOfKin);
      const kinError = nextOfKinListError(kin);
      if (kinError) return res.status(400).json({ message: kinError });
      member.nextOfKin = kin;
    }

    // The admission form's fields. Each is only touched when the caller sent it, so
    // saving the notes box does not wipe a date of birth nobody repeated.
    const details = detailsFromBody(req.body || {});
    if (details.error) return res.status(400).json({ message: details.error });
    if (details.dateOfBirth !== undefined) member.dateOfBirth = details.dateOfBirth;
    if (req.body.nationalId !== undefined) member.nationalId = details.nationalId;
    if (req.body.physicalAddress !== undefined) member.physicalAddress = details.physicalAddress;
    if (req.body.family !== undefined) member.family = details.family;
    if (req.body.commitment !== undefined) member.commitment = details.commitment;
    if (req.body.approvals !== undefined) member.approvals = details.approvals;

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

    for (const row of rows) {
      const { rowNumber, name, phone, email, regNumber, notes } = row;
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
      // A birth date in the sheet has to be a real date — imported silently wrong it
      // would sit on the profile for ever. Blank is fine: the sheet simply does not
      // carry that column.
      const dob = cleanDateOfBirth(row.dateOfBirth);
      if (dob.error) {
        skipped++;
        errors.push({ row: rowNumber, reason: `Invalid date of birth "${row.dateOfBirth}"` });
        continue;
      }
      // The form's emergency contact. A contact named with no way to reach anybody is
      // rejected by the same rule the admin form applies, rather than being dropped
      // silently — the point of the field is that it works in an emergency.
      const kin = nextOfKinList(
        row.emergencyName || row.emergencyPhone || row.emergencyRelationship
          ? [
              {
                name: row.emergencyName,
                relationship: row.emergencyRelationship,
                phone: row.emergencyPhone,
              },
            ]
          : []
      );
      const kinError = nextOfKinListError(kin);
      if (kinError) {
        skipped++;
        errors.push({ row: rowNumber, reason: kinError });
        continue;
      }
      try {
        const member = await Member.create({
          name,
          phone: normalized,
          email: rowEmail,
          regNumber: regNumber || (await nextRegNumber()),
          notes: notes || '',
          // The admission form's own columns, when the sheet has them. The
          // declaration and the three signatures are not importable — those are the
          // people, not the spreadsheet.
          dateOfBirth: dob.value ?? null,
          nationalId: cleanText(row.nationalId, 40),
          physicalAddress: cleanText(row.physicalAddress, 240),
          family: cleanFamily({
            spouseName: row.spouseName,
            children: row.children,
            fatherName: row.fatherName,
            motherName: row.motherName,
            fatherInLawName: row.fatherInLawName,
            motherInLawName: row.motherInLawName,
          }),
          nextOfKin: kin,
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

// The admission form's own columns, in the order the form asks for them, with the
// heading the import parser recognises. One table for the full export and the blank
// import template, so a template can never offer a heading the parser does not read.
// A date goes in as plain text: SheetJS would otherwise write a serial number whose
// date format the office has to fix by hand before the file reads properly.
const FORM_EXPORT_COLUMNS = [
  ['Date of birth', (m) => isoDay(m.dateOfBirth)],
  ['National ID', (m) => m.nationalId || ''],
  ['Physical address', (m) => m.physicalAddress || ''],
  ['Spouse', (m) => normaliseFamily(m.family).spouseName],
  ['Children', (m) => normaliseFamily(m.family).children.join('; ')],
  ['Father', (m) => normaliseFamily(m.family).fatherName],
  ['Mother', (m) => normaliseFamily(m.family).motherName],
  ['Father-in-law', (m) => normaliseFamily(m.family).fatherInLawName],
  ['Mother-in-law', (m) => normaliseFamily(m.family).motherInLawName],
  // The form's emergency contact, flattened the same way — several contacts are
  // joined so the row stays one row.
  ['Emergency contact', (m) => nextOfKinList(m.nextOfKin).map((k) => k.name).join('; ')],
  ['Emergency relationship', (m) => nextOfKinList(m.nextOfKin).map((k) => k.relationship).join('; ')],
  ['Emergency phone', (m) => nextOfKinList(m.nextOfKin).map((k) => k.phone).join('; ')],
];

// Both sides of the form the office signs by hand. Kept as columns so a member's
// paperwork can be audited from the export without opening each profile.
const SIGNATURE_EXPORT_COLUMNS = [
  ['Declaration signed by', (m) => (m.commitment?.agreed ? m.commitment.signedBy || 'yes' : '')],
  ['Declaration date', (m) => isoDay(m.commitment?.agreedAt)],
  ...APPROVAL_ROLES.map((role) => [approvalLabel(role), (m) => approvalName(m, role)]),
  ...APPROVAL_ROLES.map((role) => [`${approvalLabel(role)} date`, (m) => approvalDay(m, role)]),
];

function isoDay(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function approvalLabel(role) {
  return APPROVAL_LABELS[role] || role;
}

function approvalName(member, role) {
  const match = (member.approvals || []).find((a) => a.role === role);
  return match ? match.name : '';
}

function approvalDay(member, role) {
  const match = (member.approvals || []).find((a) => a.role === role);
  return match ? isoDay(match.signedAt) : '';
}

// GET /api/members/import-template — blank .xlsx with the exact columns
// importMembers reads, plus one filled example row so the format is obvious.
async function importTemplate(req, res, next) {
  try {
    const blank = Object.fromEntries(
      [['name', ''], ['phone', ''], ['email', ''], ['regNumber', ''], ...FORM_EXPORT_COLUMNS.map(([h]) => [h, '']), ['notes', '']]
    );
    const example = {
      ...blank,
      name: 'Jane Wanjiru',
      phone: '0712345678',
      email: 'jane@example.com',
      regNumber: '',
      'Date of birth': '1990-04-17',
      'National ID': '12345678',
      'Physical address': 'Kiambu',
      Spouse: 'Peter Wanjiru',
      Children: 'Ann; Brian',
      Father: 'James Wanjiru',
      Mother: 'Mary Wanjiru',
      'Emergency contact': 'Peter Wanjiru',
      'Emergency relationship': 'Spouse',
      'Emergency phone': '0722000111',
      notes: 'Optional note',
    };
    sendWorkbook(res, 'members-import-template.xlsx', [{ name: 'Members', rows: [example, blank] }]);
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
      // Everything the membership admission form asks for, then what the register
      // itself knows — so one export answers both "who is this member" and "what has
      // he paid".
      ...Object.fromEntries(FORM_EXPORT_COLUMNS.map(([header, read]) => [header, read(m)])),
      ...Object.fromEntries(SIGNATURE_EXPORT_COLUMNS.map(([header, read]) => [header, read(m)])),
      'Total contributed': sumMap.get(String(m._id)) || 0,
      Status: m.active ? 'active' : 'inactive',
      Notes: m.notes || '',
    }));
    sendWorkbook(res, 'members.xlsx', [{ name: 'Members', rows: sheetRows }]);
  } catch (err) {
    next(err);
  }
}

// Shared shape for the one public-facing member view there is: the passbook a
// member opens by proving his own number. Never includes loggedBy, internal ids,
// or admin metadata.
// The returned object is also reused as the body of the phone-gated PDF/Excel
// statements, so it is deliberately kept lean: no audit trail, no "issued by"
// fields.
//
// `lookupPhone` is the number the caller entered at the gate. When it matches
// the member's own number we let the member see their own contact details
// (email + next of kin) — otherwise those stay hidden, the same way the
// full phone number is never echoed back even to the member.
//
// `options.includeTeaFund` keeps the Tea Fund in the record. The member's lookup
// leaves it out: its 100 a week is deducted from every member automatically and
// the money is the Group's, so listing it among his contributions reads as money
// he paid in, which it never was. The office's own export of a member's statement
// asks for it, so the two cannot drift. Every other type — his weekly
// contribution, and any fund he actually paid into — is listed as it always was.
async function buildPublicProfile(member, lookupPhone, options = {}) {
  const callerIsSelf = lookupPhone && normalizePhone(lookupPhone) === normalizePhone(member.phone);
  const showTeaFund = Boolean(options.includeTeaFund);
  const [docs, breakdown, settings] = await Promise.all([
    Contribution.find({ memberId: member._id, deleted: false })
      .sort({ date: 1, createdAt: 1 })
      .populate('typeId', 'name isGroupFund')
      .lean(),
    typeBreakdown(member._id),
    getOrCreateSettings(),
  ]);
  const config = resolveConfig(settings);

  // What may be listed. Tea rows are still loaded — they are part of the cycle
  // maths and of the office's copy — they are simply not part of the member's
  // list. Filtering first is safe for the running balance: a tea row never adds
  // to it.
  const isTeaType = (type) => bucketForType(type) === 'chai';
  const visibleDocs = showTeaFund ? docs : docs.filter((c) => !isTeaType(c.typeId));
  const visibleBreakdown = showTeaFund
    ? breakdown
    : breakdown.filter((b) => !isTeaType({ name: b.name }));

  // Group-fund contributions (e.g. Chai) still show up as their own ledger
  // row, but don't add to the running personal balance — that money belongs
  // to the group, not the individual.
  let running = 0;
  const contributions = visibleDocs.map((c) => {
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

  const { fines, weeklySchedules } = await buildFinesAndSchedules(member, docs, settings);
  const visibleSchedules = showTeaFund
    ? weeklySchedules
    : weeklySchedules.filter((schedule) => !schedule.isTeaFund);

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
    // His own photo, shown back to him — nobody else can reach this view.
    photoUrl: member.photoUrl || '',
    // Masked even for the member himself: a shared screen or a screenshot
    // shouldn't leak a number he already knows.
    phoneMasked: maskPhone(member.phone),
    joinDate: member.joinDate || member.createdAt || null,
    contributionsCount: contributions.length,
    finesSettledCount: fines.settled.length,
    // Logged rows only: what he has paid since the cycle opened, tea excluded.
    // Kept because the statement exports still print it as its own line, but the
    // figure that answers "what does he hold?" is `ledger.money` below.
    totalContributed: running,
    // What the member actually holds, and the four figures it is made of, so the
    // passbook can show its work exactly as the treasurer's page does.
    ledger: {
      currentWeek: ledger.currentWeek,
      cycleStartWeek: config.cycleStartWeek,
      weeklyAmount: ledger.weeklyAmount,
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
    byType: visibleBreakdown.map((b) => ({
      type: b.name,
      contributed: b.contributed,
    })),
    contributions,
    fines: publicFines,
    // Only the funds the reader is meant to see: for a member's own lookup that
    // is his personal weekly contribution, never the Group's automatic tea.
    weeklySchedules: visibleSchedules,
    // Whether this copy names the Tea Fund. The statement exports read it so a
    // member's PDF and the office's PDF explain the same total in the words each
    // is entitled to.
    teaFundIncluded: showTeaFund,
    // When the caller proved their own number at the gate, the member gets to
    // see their own contact details back. Strangers (or someone looking up a
    // friend) never see email or next of kin — one of each of those is
    // personal and one is someone else's contact.
    ...(callerIsSelf && {
      email: member.email || '',
      // The list, cleaned — an empty list says "no contacts on file" just as the
      // old null did, and a member with a spouse and four children sees all five.
      nextOfKin: nextOfKinList(member.nextOfKin),
      emailNotifications: member.emailNotifications,
    }),
  };
}

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

// GET /api/members/:id/statement — admin, any member regardless of active status.
// The office's copy keeps the group's funds in it (see buildPublicProfile).
async function memberStatement(req, res, next) {
  try {
    const member = await Member.findById(req.params.id).lean();
    if (!member) return res.status(404).json({ message: 'Member not found' });
    await sendStatement(res, await buildPublicProfile(member, undefined, { includeTeaFund: true }));
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
    // Nobody reaches this without their own number, and there is no directory to
    // browse any more, so there is no other way in.
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
      // The office's copy: it keeps the Tea Fund in it, as the finance ledger
      // does — a member's own download from the lookup leaves it out.
      await buildPublicProfile(member, undefined, { includeTeaFund: true })
    );
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
};
