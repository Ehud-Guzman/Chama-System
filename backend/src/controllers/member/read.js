// The members' controller, part: read. controllers/memberController.js is the index the routes use.

const Member = require('../../models/Member');
const Contribution = require('../../models/Contribution');
const { normalizePhone } = require('../../utils/phone');
const { normalizeNationalId } = require('../../utils/nationalId');
const { getOrCreateSettings } = require('../../utils/settings');
const { resolveConfig } = require('../../utils/weekCycle');
const { computeMemberLedger } = require('../../utils/memberLedger');
const { nextOfKinList } = require('../../utils/nextOfKin');
const { typeBreakdown } = require('../../utils/typeBreakdown');
const { bucketForType } = require('../../utils/ledgerTypes');
const { normaliseFamily, admissionStatus } = require('../../utils/memberDetails');
const { decisionsForMember } = require('../constitutionController');
const { buildLedgerWalk } = require('../../utils/ledgerWalk');
const { buildFinesAndSchedules, escapeRegex, loadContributionRows, maskPhone } = require('./common');

// GET /api/members?search=&status=&page=&limit=
async function listMembers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    // Higher ceiling than other list endpoints: the admin weekly logging grid
    // needs every active member in one request to render its rows.
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const status = req.query.status || 'active';
    const search = String(req.query.search || '').trim();

    // The disciplinary officer reads the register to pick the right member and issue a fine, and is
    // given neither the ID nor the phone number whole (see below). A search that matched part of
    // them would hand them back one digit at a time — "1", "12", "123" — so for him a phone or an ID
    // matches only when it is typed in full, which is something he can only do if he already has it.
    const identityOnly = req.user.role === 'disciplinary';

    const filter = {};
    if (status === 'active') filter.active = true;
    if (status === 'inactive') filter.active = false;
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      // Phone searches should also match normalized storage format
      const normalized = normalizePhone(search);
      // An ID typed in full is matched exactly (it is the credential, so a hit
      // should be the member, not a list). It used to replace the partial match — which meant
      // "12345", the first five digits of "12345678", found nobody, because anything of five
      // characters or more was taken for a whole ID. A whole ID still matches exactly; what was
      // typed also filters as a fragment, with the separators a card is written with taken out.
      const idKey = normalizeNationalId(search);
      const idFragment = idKey ? new RegExp(escapeRegex(idKey), 'i') : null;
      filter.$or = identityOnly
        ? [
            { name: rx },
            { regNumber: rx },
            ...(normalized ? [{ phone: normalized }] : []),
            ...(idKey ? [{ nationalId: idKey }] : []),
          ]
        : [
            { name: rx },
            { phone: normalized ? normalized : rx },
            { regNumber: rx },
            { nationalId: rx },
            ...(idFragment ? [{ nationalId: idFragment }] : []),
          ];
    }

    // The disciplinary officer reads the register for one reason: to pick the right member and
    // issue a fine. His screen needs a name to recognise and a registration number and a phone to
    // tell two people apart — and that, with the phone masked, is all this endpoint returns to him.
    // The ID and the whole phone number are the two halves of the key to every member's passbook, so
    // they are not his; neither are a member's family, his next of kin, his notes, his photograph or
    // his money. A screen that does not show them is not a permission, and the register is the one
    // collection here that holds everybody.
    const membersQuery = Member.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit);
    if (identityOnly) membersQuery.select('name phone regNumber active');

    const [members, total] = await Promise.all([
      membersQuery.lean(),
      Member.countDocuments(filter),
    ]);

    // How many active members still cannot open their own record, because the
    // register holds no usable ID for them — blank, or a note like "not yet
    // issued". The members' page turns this into the one line that tells the
    // office what to chase: the members' area is keyed on the ID, so a member
    // without one has no way in at all. Counted for the whole register, not for
    // the page on screen, or a paged list would understate it.
    const withoutNationalId = await Member.countDocuments({
      active: true,
      nationalId: { $not: /^(?=.*\d)[A-Z0-9]{5,20}$/ },
    });

    // A disciplinary officer's screen shows none of the figures below, so none of them are
    // computed for him: no contribution rows are read and the cycle is not resolved. He gets the
    // page, the count, and the same "how many members have no usable ID" line the office's list
    // carries — which is a number, not a member's record.
    if (identityOnly) {
      res.json({
        // The phone is shown masked, enough to tell two Johns apart; the ID is not sent at all. They
        // are the two halves of the key to every member's passbook, and the register is the one
        // collection that holds everybody.
        members: members.map((m) => ({ ...m, phone: maskPhone(m.phone) })),
        total,
        page,
        pages: Math.ceil(total / limit) || 1,
        withoutNationalId,
      });
      return;
    }

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
          // And the group's own answer to "is he behind?" — 0 owed and 0 weeks for a member holding
          // at least the line, so the list can say he is fine without hiding the money (arrears
          // above is the plain record of the weeks). See utils/reminderLimit.
          moneyLimit: ledger.moneyLimit,
          coveredByBalance: ledger.coveredByBalance,
          chasedArrears: ledger.chasedArrears,
          chasedWeeksBehind: ledger.chasedWeeksBehind,
          chaiDue: ledger.chai.due,
        };
      }),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      withoutNationalId,
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
    // The rows as the cycle engine reads them:
    // `bucket` and `isGroupFund` decided once, from each row's type. Built once and handed to
    // both the ledger and the walk below, so the working and the figure it explains can only
    // ever be built from the same rows.
    const annotated = contributions.map((c) => ({
      ...c,
      bucket: bucketForType(c.typeId),
      isGroupFund: Boolean(c.typeId && c.typeId.isGroupFund),
      typeName: c.typeId?.name || '',
    }));
    const ledger = computeMemberLedger({ member, contributions: annotated, config });

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
        // Fines that came off the money he holds: paid out of his balance, or out of a payment he
        // handed over. The member page names it in the sentence under his balance.
        finesPaid: ledger.finesPaid,
        // The day his accounting ended, when he has been made inactive: nothing is charged to him after it.
        endedAt: ledger.endedAt,
        money: ledger.money,
        // Held less every week that has closed — what this figure read while the dues were still
        // being taken off it (utils/memberLedger). On the payload so the office can reconcile a
        // member's older statement against today's without re-deriving anything.
        moneyNetOfDues: ledger.moneyNetOfDues,
        arrears: ledger.arrears,
        // The group's line, and what it chases: the screens that say "behind" read these, so the
        // member's own page and the office's list cannot disagree about him.
        moneyLimit: ledger.moneyLimit,
        coveredByBalance: ledger.coveredByBalance,
        chasedArrears: ledger.chasedArrears,
        chasedWeeksBehind: ledger.chasedWeeksBehind,
        currentWeek: ledger.currentWeek,
        cycleStartWeek: config.cycleStartWeek,
        weeklyAmount: ledger.weeklyAmount,
        weeksScored: ledger.weeksScored,
        weeksBehind: ledger.weeksBehind,
      },
      // How the figure above was arrived at, step by step — hidden behind "Show the working" on
      // the member's page, and built from the very rows the ledger above was built from
      // (utils/ledgerWalk).
      walk: buildLedgerWalk({ member, contributions: annotated, fines, config }),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMember,
  listMembers,
};
