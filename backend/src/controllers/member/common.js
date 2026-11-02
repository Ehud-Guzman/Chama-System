// The members' controller, part: common. controllers/memberController.js is the index the routes use.

const Member = require('../../models/Member');
const Fine = require('../../models/Fine');
const ContributionType = require('../../models/ContributionType');
const Contribution = require('../../models/Contribution');
const Counter = require('../../models/Counter');
const { cleanDateOfBirth, cleanText, cleanFamily, cleanCommitment, cleanApprovals } = require('../../utils/memberDetails');
const { storedNationalId, normalizeNationalId } = require('../../utils/nationalId');
const { getOrCreateSettings } = require('../../utils/settings');
const { resolveConfig, weekNumberForDate, cycleHistory } = require('../../utils/weekCycle');
const { bucketForType } = require('../../utils/ledgerTypes');
const { buildWeeklySchedule } = require('../../utils/weeklySchedule');

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
    // Normalised on the way in, exactly as the gate normalises what a member
    // types: " 12 345 678 " and "12345678" have to be the same person's ID, or a
    // member with a correctly registered number would be told he has none.
    nationalId: storedNationalId(body.nationalId),
    physicalAddress: cleanText(body.physicalAddress, 240),
    family: cleanFamily(body.family),
    commitment: cleanCommitment(body.commitment),
    approvals: cleanApprovals(body.approvals),
  };
}

// One ID, one member. The gate looks an ID up to decide whose record to show, so
// two records holding the same number leave it with no correct answer — it refuses
// rather than guess (see utils/publicAccess). Checking here on create, edit and
// import is what keeps that situation out of the register in the first place.
// A note ("not yet issued") is not an ID and is never checked: a dozen members can
// share one and none of them can open anything with it.
async function nationalIdClash(nationalId, exceptMemberId) {
  const key = normalizeNationalId(nationalId);
  if (!key) return null;
  const filter = { nationalId: key };
  if (exceptMemberId) filter._id = { $ne: exceptMemberId };
  return Member.findOne(filter).select('name').lean();
}

const idClashMessage = (clash) =>
  `That ID is already on ${clash.name}'s record — each member needs his own.`;

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
      .select('memberId typeId amount grossAmount fineDeducted date')
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

// Keeps first 2 and last 3 digits, masks the rest. Phone is always the fixed
// 10-char normalized format (0[17]XXXXXXXX), so slicing at fixed offsets is safe.
function maskPhone(phone) {
  return `${phone.slice(0, 2)}XX XXX ${phone.slice(7)}`;
}

module.exports = {
  buildFinesAndSchedules,
  detailsFromBody,
  escapeRegex,
  idClashMessage,
  loadContributionRows,
  maskPhone,
  nationalIdClash,
  nextRegNumber,
};
