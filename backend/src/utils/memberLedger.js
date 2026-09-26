const { weekNumberForDate, weekRange, currentWeekNumber, scoredWeeks } = require('./weekCycle');

// Everything one member's ledger shows, computed in a single pass.
//
// The rule, as agreed with the treasurer:
//
//   required so far = weeklyAmount × the weeks that have closed since the opening
//                     week (0 while a week is still running, 1,400 the day after its
//                     Thursday passes, 2,800 the week after, …)
//   his money       = openingBalance + what he has paid since the cycle opened
//                     − tea
//   tea             = totalled on its own (§7.2) but still comes *out* of his
//                     money, exactly as the paper ledger's
//                     "Previous + Weekly + Extra − Chai = Member Total" did
//
// A week is scored once it has closed, not while it is running: the group collects
// a week's money on its Thursday, so the 1,400 and the tea are counted from the day
// after. That is what leaves an empty book reading zero and a keyed-in total reading
// exactly as keyed until that first collection lands — and why a week nobody pays
// shows as behind only once its Thursday is behind us.
//
// The opening week — week 92, the week the books opened — is the **baseline** and
// is never scored either. The totals keyed in for it are the members' money for
// that week, chai already deducted, verified against the paper ledger, so counting
// it again would bill a week that was already settled.
//
// "What he has paid" is the weekly contribution plus anything extra, so paying
// above 1,400 in a week pushes his money up instead of being swallowed.
//
// **A closed week nobody paid is reported, never taken off his money.** The old
// arithmetic netted `required` out of the held figure, so a member holding 1,400
// who missed a week read −100 rather than 1,400 with 1,400 owed — the money that
// had never been paid looking as though it had been collected and spent. The
// paper ledger never did that: its total column was "Previous + Weekly + Extra −
// Chai", and the week's 1,400 was a line the member *owed* against the next
// collection. So the engine keeps the two questions apart and answers both:
//
//   money           = what the group is actually holding for him
//   arrears         = the weeks that have closed and are still unpaid (§7.5)
//   moneyNetOfDues  = money − required, which is exactly what the old figure read
//
// That last field is why this change is reconcilable rather than a fork in the
// books: every member's figure before this rule equals `moneyNetOfDues` now, so
// a statement printed last week and one printed today can be read against each
// other (`held − dues = what the books used to show`). Nothing was ever stored
// netted — the deduction was derived on the way out — so the whole book moves at
// once and no member's opening balance has to be touched.
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
  // Weeks that carry an expectation: none of the opening week (92) and none of the
  // week still running — one the day after that week's Thursday passes, two the
  // week after, and so on. See the rule at the top.
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

  // What is still **owing**, week by week — a different question from `settled` above.
  //
  // `settled` is the paper ledger's weekly column: was this week's money in by the time the week
  // closed? A member who pays his 1,400 on the Friday after the Thursday is NILL in that column,
  // and rightly so — nothing came in that week, and §7.5's fine is about the deadline.
  //
  // What a member is *told he owes* has to be the money, not the deadline. A later payment settles
  // an earlier shortfall: 3,000 handed over the day after a missed week covers it and leaves credit
  // behind, so nothing is outstanding even though that week was never paid in its own week. Quoting
  // the weekly column as the debt is how a member who has paid everything gets emailed "Week 93 —
  // 1,400 short" while his own passbook, built from `arrears`, says he owes nothing. Those two
  // sentences may never disagree: the arrears are handed out to the weeks oldest-first — the
  // deficits always sit at the oldest unsettled week, because credit carries forward — so the
  // amounts add up to `arrears` exactly, and the weeks that are going to be named as owing are the
  // ones the money is actually short of.
  //
  // Nothing here changes a figure: `settled`, `shortfall` and the NILL fine flag are untouched, and
  // the sum of `owed` is `arrears` (see the assertions in test/memberLedger.test.js).
  let outstanding = Math.max(0, required - paid);
  for (const w of weeks) {
    if (w.isBaseline || w.isCurrent) {
      // Nothing is owed against the opening week, and the week still running has not closed.
      w.owed = 0;
      w.behind = false;
      continue;
    }
    w.owed = Math.min(Math.max(0, w.shortfall), outstanding);
    outstanding -= w.owed;
    w.behind = w.owed > 0;
  }

  const weeksBehind = weeks.filter((w) => w.behind).length;

  const openingBalance = Number(member.openingBalance) || 0;
  // What he has paid against what the cycle expected of him. Positive is credit
  // carried forward (§7.5's "cumulative actual less cumulative required"),
  // negative is arrears. It is a *measure of standing*, not a movement of money:
  // the held figure below is built from money that actually came in.
  const movement = paid - required;
  const chaiWeek = weeks.find((w) => w.isCurrent);
  // Tea comes off his money every closed week, whether or not he paid: it is money the Group has
  // spent on his behalf, so unlike a missed contribution it is a real movement of that money. The
  // automatic figure covers the scored weeks; tea collected for the weeks before the cycle opened
  // was logged, so it is added to it here.
  const teaOffMoney = chaiDue + chaiBeforeCycle;
  // The money the group is holding for him: what he carried in, plus what he has
  // actually paid in, less the tea that came off it. A closed week nobody paid
  // does NOT come off it — see the rule at the top of this file; that week shows
  // as `arrears` and is collected against the next week's payment.
  const money = openingBalance + paid - teaOffMoney;
  // The figure the books showed while the week's expectation was still being
  // netted out of the held money: carried in + paid in − dues so far − tea. Kept
  // on the payload because "it has already happened" is answerable with it — a
  // member's statement from before this rule, or a screenshot of it, reconciles
  // as `money − required`, figure for figure, with nothing else moving.
  const moneyNetOfDues = openingBalance + movement - teaOffMoney;

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
    // Held less every week that has closed (`money − required`): what this member's
    // figure read while the dues were still being netted out of it. Printed by the
    // screens that have to reconcile against an older statement, and the reason
    // "it has already happened" is a subtraction rather than a restatement.
    moneyNetOfDues,
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
    // Closed weeks the money has not covered yet: what the member is *behind* in the only sense a
    // reminder, a statement or his own passbook may quote — money still owing. `settled` below is
    // the looser, deadline-based record the treasurer's week table shows (was that week's money in
    // by its Thursday), and a week can be one without the other: a member who pays a week late has
    // an unsettled week and nothing behind him.
    weeksBehind,
    // Weeks the walk could not settle *in their own week* — the same condition the NILL fine reads,
    // and what the treasurer's page shows as "owing" against a week. The week still running counts
    // in it too (nothing has settled it yet), so this is not a count of debts: see `w.owed` for what
    // is still owed week by week, `weeksBehind` for the weeks that are actually a debt, and
    // `arrears` for the total.
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
    // The same figure as the old arithmetic read — see computeMemberLedger. On the
    // list so the treasurer's ledger can show what a member's page said last week
    // beside what it says now, and reconcile the two without a second query.
    moneyNetOfDues: ledger.moneyNetOfDues,
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
    // How many weeks have closed — the engine's own count, passed through rather
    // than re-derived by the client. While it is 0 nobody owes anything and nobody
    // can have settled anything, which is what a member's row says out loud.
    weeksScored: ledger.weeksScored,
    nillWeeksDueFine: ledger.nillWeeksDueFine,
  };
}

// Chama-wide totals for the ledger header. Kept beside the per-member maths so
// an overall figure is always the sum of the rows underneath it.
function totalLedger(ledgers) {
  return ledgers.reduce(
    (acc, l) => ({
      money: acc.money + l.money,
      // The same total as the old arithmetic read, kept beside it: the two differ
      // by exactly the members' arrears, which is the sentence the header prints.
      moneyNetOfDues: acc.moneyNetOfDues + l.moneyNetOfDues,
      openingBalance: acc.openingBalance + l.openingBalance,
      paid: acc.paid + l.paid,
      required: acc.required + l.required,
      arrears: acc.arrears + l.arrears,
      credit: acc.credit + l.credit,
      chaiPaid: acc.chaiPaid + l.chai.due,
      chaiRecorded: acc.chaiRecorded + l.chai.recorded,
    }),
    {
      money: 0,
      moneyNetOfDues: 0,
      openingBalance: 0,
      paid: 0,
      required: 0,
      arrears: 0,
      credit: 0,
      chaiPaid: 0,
      chaiRecorded: 0,
    }
  );
}

module.exports = { computeMemberLedger, summariseMember, totalLedger };
