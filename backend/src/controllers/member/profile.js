// The members' controller, part: profile. controllers/memberController.js is the index the routes use.

const Contribution = require('../../models/Contribution');
const { typeBreakdown } = require('../../utils/typeBreakdown');
const { getOrCreateSettings } = require('../../utils/settings');
const { resolveConfig } = require('../../utils/weekCycle');
const { bucketForType } = require('../../utils/ledgerTypes');
const { computeMemberLedger } = require('../../utils/memberLedger');
const { computePeriodBlock } = require('../../utils/statementPeriod');
const { buildLedgerWalk } = require('../../utils/ledgerWalk');
const { nextOfKinList } = require('../../utils/nextOfKin');
const { buildFinesAndSchedules, maskPhone } = require('./common');

// Shared shape for the one public-facing member view there is: the passbook a
// member opens by proving his own ID. Never includes loggedBy, internal ids,
// or admin metadata.
// The returned object is also reused as the body of the ID-gated PDF/Excel
// statements, so it is deliberately kept lean: no audit trail, no "issued by"
// fields.
//
// `options.self` says the caller already proved he is this member at the gate.
// Every public caller has: the lookup only ever answers for the ID it was given,
// so a match *is* the member, and that is what lets him see his own email and
// next of kin back — nobody else's copy of the passbook carries them. The office
// passes no flag: its own statements are opened from the admin app, and the
// passbook shape must not start leaking contacts out of a download.
//
// `options.includeTeaFund` keeps the Tea Fund in the record. The member's lookup
// leaves it out: its 100 a week is deducted from every member automatically and
// the money is the Group's, so listing it among his contributions reads as money
// he paid in, which it never was. The office's own export of a member's statement
// asks for it, so the two cannot drift. Every other type — his weekly
// contribution, and any fund he actually paid into — is listed as it always was.
async function buildPublicProfile(member, options = {}) {
  const callerIsSelf = Boolean(options.self);
  const showTeaFund = Boolean(options.includeTeaFund);
  const period = options.period || null;
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
  //
  // Built once and reused below for the period's own two calls, so a statement cannot be
  // reconciling against a differently-annotated set of the same rows.
  const annotated = docs.map((c) => ({
    ...c,
    bucket: bucketForType(c.typeId),
    isGroupFund: Boolean(c.typeId && c.typeId.isGroupFund),
  }));
  const ledger = computeMemberLedger({ member, contributions: annotated, config });

  // A statement for a period ("his 2026", "this quarter"). The block's figures come from the same
  // engine, called as at the period's two ends — which is what makes the statement's arithmetic
  // reconcile instead of being a sum of whichever rows happened to fall inside the dates
  // (utils/statementPeriod explains why that matters).
  const periodBlock = period
    ? computePeriodBlock({
        member,
        config,
        all: annotated,
        // The rows the reader is entitled to see. The engine above still sees everything, tea
        // included, because that is what the tea deduction is reconciled against.
        visible: contributions,
        period,
      })
    : null;
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

  // The working behind `ledger.money`, one step at a time: the same rows and the same engine the
  // figures above come from, so the passbook's own "Show the working" cannot disagree with the
  // figure it is explaining (utils/ledgerWalk). The fines ride the walk's own column, exactly as
  // they are kept out of the money held. The raw fines are used rather than `publicFines`, because
  // a settlement's date is what puts it on the right day of the walk.
  const walk = buildLedgerWalk({ member, contributions: annotated, fines, config });

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
      // Fines that came off the money he holds (paid out of his balance, or out of a payment he
      // handed over). 0 for a member whose fines were all paid in cash on the side.
      finesPaid: ledger.finesPaid,
      money: ledger.money,
      // Held less every week that has closed — the figure the passbook's card used to subtract the
      // dues from, kept so a member's older copy reconciles (utils/memberLedger).
      moneyNetOfDues: ledger.moneyNetOfDues,
      arrears: ledger.arrears,
      // Read by the passbook's position card: a member holding at least the group's line is told he
      // is fine, not that he is behind (utils/reminderLimit).
      moneyLimit: ledger.moneyLimit,
      coveredByBalance: ledger.coveredByBalance,
      chasedArrears: ledger.chasedArrears,
      chasedWeeksBehind: ledger.chasedWeeksBehind,
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
    // The same rows, the same engine, in the order they happened — what the passbook's own position
    // card is made of, and what "Show the working" prints. On a member's own lookup it is what stops
    // the biggest figure on the page from being a number nobody can check against anything.
    walk,
    // The period block, when the caller asked for one. Deliberately not exposed on the passbook
    // JSON: the lookup has no period, and a field nobody asked for is a field somebody will
    // misread. It is attached here because the PDF and the workbook both render this same object.
    ...(periodBlock ? { period: periodBlock } : {}),
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
    //
    // **Only when the phone number was proved as well.** An ID is on a card and in other people's
    // phones, and the contacts are more sensitive than the balance: his email, and a list of other
    // people's names, relationships and phone numbers. With the group's phone check off, a stranger
    // holding the card would be handed all of it, so it is held back — `contactsHeld` tells the
    // screen to say so rather than show an empty "no contacts on file".
    ...(callerIsSelf && options.contactsVerified
      ? {
          email: member.email || '',
          // The list, cleaned — an empty list says "no contacts on file" just as the
          // old null did, and a member with a spouse and four children sees all five.
          nextOfKin: nextOfKinList(member.nextOfKin),
          emailNotifications: member.emailNotifications,
        }
      : {}),
    ...(callerIsSelf && !options.contactsVerified ? { contactsHeld: true } : {}),
  };
}

module.exports = {
  buildPublicProfile,
};
