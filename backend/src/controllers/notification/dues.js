// The reminders controller, part: dues. controllers/notificationController.js is the index the routes use.

const ContributionType = require('../../models/ContributionType');
const Contribution = require('../../models/Contribution');
const Fine = require('../../models/Fine');
const Member = require('../../models/Member');
const { getOrCreateSettings } = require('../../utils/settings');
const { resolveConfig, currentWeekNumber } = require('../../utils/weekCycle');
const { moneyLimitForWeek, coveredByBalance } = require('../../utils/reminderLimit');
const { bucketForType, WEEKLY_TYPE_NAME } = require('../../utils/ledgerTypes');
const { computeMemberLedger } = require('../../utils/memberLedger');

// Required for the populate in computeMemberDues, not for anything named below: mongoose
// resolves a `ref` by name when the query runs, so the model has to be registered in the
// process, by whoever else happens to be there. The API process gets away with not doing it
// here because fineTypeRoutes imports the model on the way past — which is exactly why the
// omission went unnoticed until the reminder sweep was run by hand (`npm run job:reminders`,
// a process that boots no routes) and died with "Schema hasn't been registered for
// model \"FineType\"" instead of sending anything.
require('../../models/FineType');

// One request should never try to email the whole group and then time out — the
// page selects a handful at a time, and the sends happen inside this request. Fifty
// is roughly a minute of SMTP at three connections, which is as long as an HTTP
// request here can honestly be expected to take; a larger selection is refused with
// a message asking for batches (the alternative — sending in the background — needs
// a job store and a way to tell the treasurer how it went).
const MAX_RECIPIENTS = 50;

// Works out exactly what a set of members still owes: unpaid weekly
// contribution weeks and unpaid fines. This is the same maths the member's own
// page shows (computeMemberLedger), so an email can never claim something
// the member's own statement contradicts.
//
// **And it works out who is not to be told about it.** A member holding at least the group's own
// moving line (Settings.reminderMoneyLimit, utils/reminderLimit) has his late weeks taken out of
// what he "owes" for the purpose of being written to: he is behind on the week-by-week count and by
// that count alone, and the treasurer's own instruction is that he is not nagged about it. The
// weeks themselves are kept in `lateWeeksIgnored` rather than thrown away, so the reminders screen
// can still say why he was left alone. His fines stay: a fine is not a weekly nudge.
async function computeMemberDues(members, { settings: givenSettings = null } = {}) {
  const ids = members.map((m) => m._id);
  if (ids.length === 0) return new Map();

  const [types, settings, contributions, pendingFines] = await Promise.all([
    ContributionType.find().select('name isGroupFund isWeekly').lean(),
    // A caller that already loaded the settings row passes it in: the weekly sweep and the
    // reminders screen both have it, and a second read would be a second answer waiting to happen.
    givenSettings ? Promise.resolve(givenSettings) : getOrCreateSettings(),
    Contribution.find({ memberId: { $in: ids }, deleted: false })
      .select('memberId typeId amount grossAmount fineDeducted date')
      .lean(),
    Fine.find({ memberId: { $in: ids }, deleted: false, remaining: { $gt: 0 } })
      .populate('typeId', 'name')
      .lean(),
  ]);

  const config = resolveConfig(settings);
  // The line as it stands this week, or 0 when the rule is switched off.
  const weekNumber = currentWeekNumber(config);
  const moneyLimit = moneyLimitForWeek(settings, config, weekNumber);

  // What a member holds is measured *including* what he carried into the cycle, so a caller's
  // projection has to have asked for `openingBalance`. If one did not, read it here rather than
  // quietly measuring everybody against their payments alone — that reads as "nobody has anything"
  // and emails exactly the members the group asked to be left alone, which is what happened when
  // the reminders list, the send and the sweep all selected fields without it. The extra query only
  // happens when a row is actually missing the field, so the three callers that select it pay
  // nothing (see the projections in listReminders, sendReminders and job:reminders).
  // The fines paid out of his balance come off the same figure, so they are read with it. (Only the
  // carried-in balance is checked for: a member who has never had a fine paid from his balance has no
  // `fineDebits` on his record at all, so its absence says nothing. Every caller selects it.)
  const missingOpening = members.filter((m) => !('openingBalance' in m));
  const openings = missingOpening.length
    ? new Map(
        (
          await Member.find({ _id: { $in: missingOpening.map((m) => m._id) } })
            .select('openingBalance fineDebits')
            .lean()
        ).map((m) => [String(m._id), { openingBalance: Number(m.openingBalance) || 0, fineDebits: m.fineDebits || [] }])
      )
    : null;
  const typeById = new Map(types.map((t) => [String(t._id), t]));
  const byMember = new Map();
  for (const c of contributions) {
    const type = typeById.get(String(c.typeId));
    const annotated = {
      ...c,
      bucket: bucketForType(type),
      isGroupFund: Boolean(type && type.isGroupFund),
    };
    const key = String(c.memberId);
    if (!byMember.has(key)) byMember.set(key, []);
    byMember.get(key).push(annotated);
  }

  // The week requirements come from the same cycle engine the treasurer logs
  // against, so a reminder can never quote a different week number or a
  // different amount from the member's own page. Weeks before the cycle
  // started simply aren't in the ledger, so unreconcilable history can't be
  // emailed to anyone — the old per-member-join-date schedule could, and did.
  const dues = new Map();

  for (const member of members) {
    const ledger = computeMemberLedger({
      // A member row that was projected without his carried-in balance has it filled in from the
      // read above; a caller that selected it passes straight through.
      member: openings
        ? { ...member, ...(openings.get(String(member._id)) || { openingBalance: 0, fineDebits: [] }) }
        : member,
      contributions: byMember.get(String(member._id)) || [],
      config,
    });

    // The weeks the money is missing from — `behind`, and `shortfall` is what that week itself is
    // short. Each closed week carries its own 1,400 (no surplus from another week answers it), so
    // these add up to exactly the arrears on the member's own page, which is what the ledger's own
    // `weeksBehind` counts.
    const lateWeeks = ledger.weeks
      .filter((w) => w.behind)
      .map((w) => ({
        weekNumber: w.weekNumber,
        startDate: w.startDate,
        typeName: WEEKLY_TYPE_NAME,
        expected: ledger.weeklyAmount,
        paid: w.personalPaid,
        shortfall: w.shortfall,
      }));

    const fines = pendingFines
      .filter((f) => String(f.memberId) === String(member._id))
      .map((f) => ({
        id: f._id,
        reason: f.reason || f.typeId?.name || 'Fine',
        date: f.date,
        remaining: f.remaining,
      }));

    const finesTotal = fines.reduce((sum, f) => sum + f.remaining, 0);
    const lateTotal = lateWeeks.reduce((sum, w) => sum + w.shortfall, 0);

    // Above the line, the late weeks stop being something he is told about. They are not thrown
    // away: `lateWeeksIgnored` carries how many there were, so a screen can explain the row instead
    // of leaving the office to wonder whether the engine saw them.
    const covered = coveredByBalance(ledger.money, moneyLimit) && lateWeeks.length > 0;

    dues.set(String(member._id), {
      lateWeeks: covered ? [] : lateWeeks.sort((a, b) => a.weekNumber - b.weekNumber),
      lateWeeksIgnored: covered ? lateWeeks.length : 0,
      fines,
      finesTotal,
      lateTotal: covered ? 0 : lateTotal,
      // What the group is holding for him, and the line it was measured against. On the payload so
      // the screen and the audit trail can both say what the decision was made of.
      moneyHeld: ledger.money,
      moneyLimit,
      weekNumber,
      coveredByBalance: covered,
      total: finesTotal + (covered ? 0 : lateTotal),
    });
  }

  return dues;
}

module.exports = {
  MAX_RECIPIENTS,
  computeMemberDues,
};
