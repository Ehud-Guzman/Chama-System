const { cycleWeekNumber, weekRange, currentWeekNumber } = require('./weekCycle');

// Everything one member's ledger shows, computed in a single pass.
//
// The rule, as agreed with the treasurer:
//
//   required so far = weeklyAmount × weeks elapsed since the opening week
//                     (1,400 in week 92, 2,800 in week 93, …)
//   his money       = openingBalance + what he has paid since week 92
//                     − required − tea recorded against him
//   tea             = totalled on its own (§7.2) but still comes *out* of his
//                     money, exactly as the paper ledger's
//                     "Previous + Weekly + Extra − Chai = Member Total" did
//
// "What he has paid" is the weekly contribution plus anything extra, so paying
// above 1,400 in a week pushes his money up instead of being swallowed. A week
// where nothing was paid takes 1,400 back off it — that is the "expected total
// deducted from his money" the members already work to, which is also the
// accumulated credit/arrears of constitution §7.5.
//
// Tea is deducted as it is *recorded*, never as an assumption: the ledger only
// ever moves money somebody actually entered, and the tea shortfall is reported
// separately so nobody can be quietly short of it without it showing.
//
// Contributions are expected pre-annotated by the caller with:
//   bucket      'weekly' | 'extra' | 'chai' | 'other'
//   isGroupFund whether the money belongs to the Group rather than the member
function computeMemberLedger({ member, contributions, config, now = Date.now() }) {
  const currentWeek = currentWeekNumber(config, now);
  const elapsed = currentWeek - config.cycleStartWeek + 1;
  const required = config.weeklyAmount * elapsed;
  const chaiRequired = config.chaiAmount * elapsed;

  // One row per week of the live cycle, pre-seeded so a week nobody paid still
  // appears (a NILL week is a status the ledger must show, not an absence of
  // data — §7.4).
  const weekMap = new Map();
  for (let w = config.cycleStartWeek; w <= currentWeek; w++) {
    weekMap.set(w, {
      ...weekRange(w, config),
      paid: 0,
      extraPaid: 0,
      chaiPaid: 0,
      otherPaid: 0,
      logs: [],
    });
  }

  let paid = 0;
  let extraPaid = 0;
  let chaiPaid = 0;
  let otherPaid = 0;
  let otherGroupPaid = 0;

  for (const c of contributions) {
    const week = cycleWeekNumber(c.date, config);
    const row = weekMap.get(week);
    // grossAmount is what the member physically handed over when part of a
    // payment was redirected to settle a fine. The ledger follows cash in, so
    // the week is credited the full amount the member actually paid.
    const cash = Number(c.grossAmount ?? c.amount) || 0;

    if (c.bucket === 'weekly') {
      paid += cash;
      if (row) row.paid += cash;
    } else if (c.bucket === 'extra') {
      extraPaid += cash;
      paid += cash;
      if (row) row.extraPaid += cash;
    } else if (c.bucket === 'chai') {
      chaiPaid += cash;
      if (row) row.chaiPaid += cash;
    } else if (c.isGroupFund) {
      // A group fund left over from the old type set (registration fees and the
      // like) — real income, but never a member's personal money.
      otherGroupPaid += cash;
    } else {
      otherPaid += cash;
      if (row) row.otherPaid += cash;
    }
    if (row) row.logs.push(c._id);
  }

  const weeks = [...weekMap.values()].map((w) => {
    const personalPaid = w.paid + w.extraPaid;
    let status = 'nill';
    if (config.weeklyAmount > 0 && personalPaid >= config.weeklyAmount) status = 'paid';
    else if (personalPaid > 0) status = 'partial';
    return { ...w, personalPaid, status, isCurrent: w.weekNumber === currentWeek };
  });


  // Credit-aware walk. Money paid above the requirement in one week covers a
  // later week nobody paid, exactly as §7.5's "cumulative actual less cumulative
  // required" describes — so a member clearing three weeks of arrears in one
  // entry shows all three settled, not three NILL weeks plus loose credit.
  //
  // `status` stays the raw record (was anything paid *that* week); `settled` is
  // what the treasurer cares about (is that week covered, by payment or credit).
  // §7.5 — a NILL week only attracts the KES 50 fine when the credit standing
  // before it is less than one week's requirement; a NILL week the member had
  // already covered out of earlier surplus attracts nothing. Credit here is
  // cycle-only (openingBalance is deliberately excluded: it is pre-cycle money,
  // not a qualifying weekly contribution). The fine is reported, never charged:
  // a fine must be issued with its week, reason and calculation, so the figure
  // stays advisory until somebody actually issues it. A week still running is
  // never "unpaid yet" — its deadline hasn't passed.
  let credit = 0;
  for (const w of weeks) {
    const available = credit + w.personalPaid;
    w.settled = config.weeklyAmount > 0 && available >= config.weeklyAmount;
    // Cumulative gap at the end of that week, not a fresh per-week figure.
    w.shortfall = Math.max(0, config.weeklyAmount - available);
    w.coveredByCredit = w.status === 'nill' && w.settled;
    w.nillFineDue = !w.isCurrent && w.status === 'nill' && !w.settled;
    credit = available - config.weeklyAmount;
  }

  const weeksBehind = weeks.filter((w) => !w.isCurrent && !w.settled).length;

  const openingBalance = Number(member.openingBalance) || 0;
  const movement = paid - required;
  const chaiWeek = weeks.find((w) => w.isCurrent);
  // Tea comes out of his money like any other week's deduction, so the balance
  // he sees is the same figure the paper ledger's total column used to hold.
  const money = openingBalance + movement - chaiPaid;

  return {
    currentWeek,
    weeksElapsed: elapsed,
    weeklyAmount: config.weeklyAmount,
    chaiAmount: config.chaiAmount,
    openingBalance,
    paid,
    extraPaid,
    otherPaid,
    otherGroupPaid,
    required,
    movement,
    money,
    arrears: movement < 0 ? -movement : 0,
    credit: movement > 0 ? movement : 0,
    chai: {
      paid: chaiPaid,
      required: chaiRequired,
      // How much tea is missing, if any — never silently absorbed into his
      // balance, because he is only charged for tea that was recorded.
      shortfall: Math.max(0, chaiRequired - chaiPaid),
      difference: chaiPaid - chaiRequired,
      thisWeek: chaiWeek ? chaiWeek.chaiPaid : 0,
      deductedFromMoney: chaiPaid,
    },
    weeksPaid: weeks.filter((w) => w.status === 'paid').length,
    weeksPartial: weeks.filter((w) => w.status === 'partial').length,
    weeksNill: weeks.filter((w) => w.status === 'nill').length,
    // Weeks the money hasn't covered yet — closed ones only ("behind"), and
    // including the running week ("to catch up"), which is what the treasurer's
    // one-tap "cover everything" needs to know.
    weeksBehind,
    weeksUnsettled: weeks.filter((w) => !w.settled).length,
    nillWeeksDueFine: weeks.filter((w) => w.nillFineDue).map((w) => w.weekNumber),
    weeks,
  };
}

// List-page projection — the same numbers minus the week-by-week detail, so the
// member list and the member page can never disagree about anyone.
function summariseMember(member, ledger) {
  return {
    _id: member._id,
    name: member.name,
    regNumber: member.regNumber || null,
    phone: member.phone,
    active: member.active,
    openingBalance: ledger.openingBalance,
    money: ledger.money,
    required: ledger.required,
    paid: ledger.paid,
    extraPaid: ledger.extraPaid,
    arrears: ledger.arrears,
    credit: ledger.credit,
    chaiPaid: ledger.chai.paid,
    chaiThisWeek: ledger.chai.thisWeek,
    chaiShortfall: ledger.chai.shortfall,
    weeksPaid: ledger.weeksPaid,
    weeksPartial: ledger.weeksPartial,
    weeksNill: ledger.weeksNill,
    weeksBehind: ledger.weeksBehind,
    weeksUnsettled: ledger.weeksUnsettled,
    nillWeeksDueFine: ledger.nillWeeksDueFine,
  };
}

// Chama-wide totals for the ledger header. Kept beside the per-member maths so
// an overall figure is always the sum of the rows underneath it.
function totalLedger(ledgers) {
  return ledgers.reduce(
    (acc, l) => ({
      money: acc.money + l.money,
      openingBalance: acc.openingBalance + l.openingBalance,
      paid: acc.paid + l.paid,
      required: acc.required + l.required,
      arrears: acc.arrears + l.arrears,
      credit: acc.credit + l.credit,
      chaiPaid: acc.chaiPaid + l.chai.paid,
      chaiRequired: acc.chaiRequired + l.chai.required,
    }),
    { money: 0, openingBalance: 0, paid: 0, required: 0, arrears: 0, credit: 0, chaiPaid: 0, chaiRequired: 0 }
  );
}

module.exports = { computeMemberLedger, summariseMember, totalLedger };
