const { weekNumberForDate, weekRange, currentWeekNumber, scoredWeeks } = require('./weekCycle');

// Everything one member's ledger shows, computed in a single pass.
//
// The rule, as agreed with the treasurer:
//
//   required so far = weeklyAmount × the weeks scored since the opening week
//                     (0 through week 92, 1,400 in week 93, 2,800 in 94, …)
//   his money       = openingBalance + what he has paid since the cycle opened
//                     − required − tea
//   tea             = totalled on its own (§7.2) but still comes *out* of his
//                     money, exactly as the paper ledger's
//                     "Previous + Weekly + Extra − Chai = Member Total" did
//
// A week is scored from its first day, so the money the group collects on its
// Thursday is already the expectation the member's money is measured against —
// §7.5's "expected total deducted from his money". A week nobody pays shows as
// behind from the day after its Thursday passes.
//
// The opening week — week 92, the week the books opened — is the **baseline** and
// is never scored. The totals keyed in for it are the members' money *with the tea
// already deducted*, verified against the paper ledger, so billing 1,400 and 100
// more for that week would report the whole group behind on the day the cycle
// started, off a balance that was checked without them. Deductions begin with the
// week after it: week 93.
//
// "What he has paid" is the weekly contribution plus anything extra, so paying
// above 1,400 in a week pushes his money up instead of being swallowed. A scored
// week where nothing was paid takes 1,400 back off it — that is the "expected
// total deducted from his money" the members already work to, which is also the
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
  // Weeks that carry an expectation: none in the opening week (week 92), one in
  // week 93 from its first day, two in week 94, and so on. See the rule at the top.
  const weeksScored = scoredWeeks(config, now);
  const required = config.weeklyAmount * weeksScored;
  // Tea is automatic: every member is charged the week's tea for every scored week
  // of the cycle, whether or not anybody logged anything, and the money goes to
  // the Group's fund. That is why there is no such thing as tea arrears and no tea
  // entry to write — it is a straight deduction, exactly as the paper ledger's
  // total column treated it.
  const chaiDue = config.chaiAmount * weeksScored;

  // One row per week of the live cycle, pre-seeded so a week nobody paid still
  // appears (a NILL week is a status the ledger must show, not an absence of
  // data — §7.4). The opening week is flagged as the baseline: it is listed so
  // the numbering reads as the paper ledger's did, but it is never scored.
  const weekMap = new Map();
  for (let w = config.cycleStartWeek; w <= currentWeek; w++) {
    const isBaseline = w === config.cycleStartWeek;
    weekMap.set(w, {
      ...weekRange(w, config),
      paid: 0,
      extraPaid: 0,
      chaiPaid: 0,
      // The week's tea, automatic for every member — see chaiDue below. Nothing
      // comes off the baseline week, which is where the opening balance stands.
      chaiAmount: isBaseline ? 0 : config.chaiAmount,
      otherPaid: 0,
      isBaseline,
      logs: [],
    });
  }

  let paid = 0;
  let extraPaid = 0;
  let chaiPaid = 0;
  let otherPaid = 0;
  let otherGroupPaid = 0;
  // Tea by the cup, for weeks the automatic deduction does not reach: the weeks
  // before the cycle opened (1..91), where the tea was collected off the paper
  // ledger and can only be known from what was logged. The one-time week-91
  // entry is the case this exists for. Inside the scored window the automatic
  // figure already covers tea, so a row there is reported, never counted twice.
  let chaiBeforeCycle = 0;
  // Money collected in those same weeks, so the week list can show it against the
  // week it was actually collected in instead of it vanishing into week 92.
  const historyPaid = new Map();

  for (const c of contributions) {
    // The week the money was collected in, unclamped. A payment dated before the
    // cycle opened has no row in the live window — it belongs to one of the weeks
    // the ledger only lists — so it is kept aside as history rather than folded
    // into the opening week.
    const trueWeek = weekNumberForDate(c.date, config);
    const isHistory = trueWeek < config.cycleStartWeek;
    const row = isHistory ? null : weekMap.get(trueWeek);
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
      if (isHistory) chaiBeforeCycle += cash;
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

    if (isHistory) {
      const entry =
        historyPaid.get(trueWeek) ||
        { weekNumber: trueWeek, paid: 0, chaiPaid: 0, logs: [] };
      if (c.bucket === 'weekly' || c.bucket === 'extra') entry.paid += cash;
      if (c.bucket === 'chai') entry.chaiPaid += cash;
      entry.logs.push(c._id);
      historyPaid.set(trueWeek, entry);
    }
  }

  const weeks = [...weekMap.values()].map((w) => {
    const personalPaid = w.paid + w.extraPaid;
    // The baseline week has no status of its own: it is neither paid, partial nor
    // NILL, and the UI labels it as the opening week.
    if (w.isBaseline) {
      return { ...w, personalPaid, status: 'baseline', isCurrent: w.weekNumber === currentWeek };
    }
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
    if (w.isBaseline) {
      // Nothing is expected of the opening week and nothing can be outstanding
      // against it, so it never sets a shortfall and never attracts the fine. It
      // also contributes no credit: the money paid during it covers the weeks that
      // follow, and the walk below starts from zero.
      w.settled = true;
      w.shortfall = 0;
      w.coveredByCredit = false;
      w.nillFineDue = false;
      continue;
    }
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
  // Tea comes out of his money like the week's other deduction, so the balance he
  // sees is the same figure the paper ledger's total column used to hold. The
  // automatic figure covers the scored weeks; tea collected for the weeks before
  // the cycle opened was logged, so it is added to it here.
  const teaOffMoney = chaiDue + chaiBeforeCycle;
  const money = openingBalance + movement - teaOffMoney;

  return {
    currentWeek,
    // Calendar weeks since the cycle opened (1 in week 92) and the weeks that
    // actually carry an expectation (0 in week 92). Two different numbers on
    // purpose: the first is what the ledger is *in*, the second is what it is
    // owed.
    weeksElapsed: elapsed,
    weeksScored,
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
      // Everything taken off his money for tea: the automatic figure for every
      // scored week of the cycle, plus the tea logged for the weeks before it
      // opened (the one-time week-91 entry). Nothing is taken for the opening week.
      due: teaOffMoney,
      automatic: chaiDue,
      beforeCycle: chaiBeforeCycle,
      perWeek: config.chaiAmount,
      weeks: weeksScored,
      thisWeek: chaiWeek ? chaiWeek.chaiAmount : 0,
      // What the rows themselves add up to — the automatic figure inside the
      // window, and the record for any tea collected before it.
      recorded: chaiPaid,
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
    // Weeks 1..(cycleStartWeek-1) that have money logged against them, so the
    // week list can show what was collected in them (the one-time week-91 entry).
    historyPaid: [...historyPaid.values()].sort((a, b) => a.weekNumber - b.weekNumber),
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
    chaiPaid: ledger.chai.due,
    chaiThisWeek: ledger.chai.thisWeek,
    chaiWeeks: ledger.chai.weeks,
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
      chaiPaid: acc.chaiPaid + l.chai.due,
      chaiRecorded: acc.chaiRecorded + l.chai.recorded,
    }),
    { money: 0, openingBalance: 0, paid: 0, required: 0, arrears: 0, credit: 0, chaiPaid: 0, chaiRecorded: 0 }
  );
}

module.exports = { computeMemberLedger, summariseMember, totalLedger };
