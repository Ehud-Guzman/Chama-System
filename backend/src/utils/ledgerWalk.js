const { toMoney } = require('./money');
const { computeMemberLedger } = require('./memberLedger');
const { weekRange, weekNumberForDate, currentWeekNumber, scoredWeeks } = require('./weekCycle');

// The working behind one member's figure, step by step.
//
// A member asks the question this file answers — "how did you get to that number?" — and every
// screen that shows him a balance can now answer it without anybody re-adding a column by hand:
// what he carried in, what he paid and when, what came off for tea and which week took it, and what
// the fines did in the meantime.
//
// It is deliberately built to be *the same arithmetic* as utils/memberLedger, not a second opinion
// about it:
//
//   held = openingBalance + every payment the engine credits − the tea the engine deducts
//
// which is why the engine is called here as well and its own `money` is carried through as
// `closing.money`. `balanced` says whether this walk arrived at the very figure the card above it
// prints; if it ever does not, the walk is the thing that is wrong, and the screen says so rather
// than quietly printing a second total.
//
// Two rules the walk keeps, exactly as the engine does:
//
//   * **A closed week nobody paid is never taken off the money.** It is money that never came in;
//     subtracting it would read as though it had been collected and spent. So it is not a step in
//     this walk at all — it is reported under `closing.arrears`, the same figure the passbook and
//     the treasurer's page quote as owed.
//   * **Fines run on their own line.** A fine is not member money: paying one does not move what the
//     group holds for him (his passbook already says "owed to the group, kept out of the figures
//     above"). A fine therefore steps the `owed` column and never the `held` one, and the two are
//     labelled separately on the screen.
//
// Money the engine keeps out of the held figure — a group fund, tea paid at the desk inside the
// cycle, a personal fund outside the weekly cycle — is still listed, with no effect on either column
// and a line saying why. A member who paid 5,000 of welfare has to find it here, named, even when
// the group's own rule is that it does not move the weekly figure.
//
// Pure: no database, no clock of its own (`now` is passed in), so the whole thing is covered by
// test/ledgerWalk.test.js.

// How many closed weeks are listed one by one before the older ones are rolled into a single line.
// The same twelve the statements use (utils/memberStatement): a wall of ninety Thursday rows is not
// a walk, it is a ledger — and the older tea is one figure anyway, the same one every week.
const WEEKS_SHOWN = 12;

// The order steps sharing a date are read in: what he carried in first, then the money that came in
// that day, then the fine it cleared. A rank breaks the tie rather than the sort being left to
// whatever order the rows happened to arrive in.
const RANK = { opening: 0, contribution: 1, teaWeek: 2, fineIssued: 1, fineSettled: 3 };

function timeOf(value, fallback = 0) {
  if (!value) return fallback;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : fallback;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const numberFmt = new Intl.NumberFormat('en-KE');
function money(amount) {
  return `Ksh ${numberFmt.format(toNumber(amount))}`;
}


// The fines as a flat, predictable list: the member screens hand them over grouped
// ({ pending, settled }), the treasurer's hand them over raw. Both arrive here as one shape.
function fineList(fines) {
  if (Array.isArray(fines)) return fines;
  if (!fines) return [];
  return [...(fines.pending || []), ...(fines.settled || [])];
}

function fineName(fine) {
  return fine.type || fine.typeId?.name || 'Fine';
}

function fineSettlements(fine) {
  return Array.isArray(fine.settlements) ? fine.settlements : [];
}

// A fine's outstanding figure, whichever fields the caller happened to send: `remaining` when it is
// there, otherwise what was charged less what has been paid against it.
function fineRemaining(fine) {
  if (fine.remaining !== undefined && fine.remaining !== null) return toMoney(fine.remaining);
  const settled = fineSettlements(fine).reduce((sum, s) => sum + toNumber(s.amount), 0);
  return toMoney(Math.max(0, toNumber(fine.amount) - settled));
}

// One step of the walk. Every field is present on every step so a screen can render the list without
// guessing: `in`/`out` move the money held, `owedIn`/`owedOut` move the fines column, `effect` says
// out loud whether the step touched the figure at the top, and `held`/`owed` are filled in once the
// whole list is in order.
function step(fields) {
  return {
    id: fields.id,
    kind: fields.kind,
    rank: fields.rank,
    date: fields.date || null,
    weekNumber: fields.weekNumber ?? null,
    label: fields.label,
    detail: fields.detail || null,
    in: toMoney(fields.in || 0),
    out: toMoney(fields.out || 0),
    owedIn: toMoney(fields.owedIn || 0),
    owedOut: toMoney(fields.owedOut || 0),
    effect: Boolean(fields.effect),
    held: 0,
    owed: 0,
  };
}

// Everything one member's walk shows, computed in a single pass.
function buildLedgerWalk({ member, contributions = [], fines = [], config, now = Date.now() }) {
  const openingBalance = toMoney(member?.openingBalance);
  const currentWeek = currentWeekNumber(config, now);
  const scored = scoredWeeks(config, now);
  const cycleStartWeek = config.cycleStartWeek;

  // The engine's own answer, for the two figures this walk has to arrive at. Called here rather
  // than trusted from the caller so the working and the figure it explains can only ever be built
  // from the same inputs. A member with no record at all is read as an empty one rather than
  // refused: the passbook is shown for members created before the opening balances existed.
  const ledger = computeMemberLedger({ member: member || {}, contributions, config, now });

  const steps = [];

  // What he carried in. The opening week (92 today) is the baseline: its money is inside this
  // figure and nothing was expected of it, so the walk names it once and moves on.
  steps.push(
    step({
      id: 'opening',
      kind: 'opening',
      rank: RANK.opening,
      date: weekRange(cycleStartWeek, config).startDate,
      weekNumber: cycleStartWeek,
      label: `Carried in at week ${cycleStartWeek}`,
      detail: 'What the paper ledger held for him when these books opened.',
      in: openingBalance,
      effect: openingBalance !== 0,
    })
  );

  // Every row against him, in the order it happened. What a row does to the held figure is decided
  // by its bucket, exactly as utils/memberLedger decides it — a payment the ledger credits cannot be
  // a step the walk ignores, and the other way round.
  for (const c of [...contributions].sort((a, b) => timeOf(a.date) - timeOf(b.date))) {
    const cash = toMoney(toNumber(c.grossAmount ?? c.amount));
    const bucket = c.bucket || 'other';
    const collectedWeek = weekNumberForDate(c.date, config);
    const inCycle = collectedWeek >= cycleStartWeek;
    const weekNumber = inCycle ? collectedWeek : null;
    const base = {
      id: `contribution:${c._id || `${c.date}-${cash}`}`,
      date: c.date,
      weekNumber,
    };
    // What the note is NOT here: the row's own M-Pesa message. Every screen that shows this walk
    // shows the rows themselves a few lines further down (the passbook's ledger, the office's
    // LedgerRows, the treasurer's log list), notes and all, so repeating them here would double the
    // weight of a member's page on a phone to say the same thing twice.
    //
    // What IS here is the one thing the row alone does not say: a payment that was partly redirected
    // to a fine. The ledger follows cash in, so the whole amount is credited — and a member who
    // handed over 1,400 and then sees 400 against his fines has to find that 400 named in the same
    // row.
    const toFine = toNumber(c.fineDeducted);
    const detail = toFine > 0 ? `${money(toFine)} of this cleared his fines.` : null;

    if (bucket === 'weekly') {
      steps.push(
        step({
          ...base,
          kind: 'weekly',
          rank: RANK.contribution,
          label: inCycle
            ? `Weekly contribution — week ${weekNumber}`
            : 'Weekly contribution — collected before these books opened',
          detail,
          in: cash,
          effect: true,
        })
      );
    } else if (bucket === 'extra') {
      // The retired "Extra Contributions" type: money above the weekly requirement, logged before
      // the type was removed. Still his money, exactly as the engine treats it.
      steps.push(
        step({
          ...base,
          kind: 'extra',
          rank: RANK.contribution,
          label: 'Extra contribution',
          detail,
          in: cash,
          effect: true,
        })
      );
    } else if (bucket === 'chai') {
      if (inCycle) {
        // Tea paid at the desk inside the cycle. The week's tea is already deducted automatically,
        // so this row reports the same money rather than moving it a second time.
        steps.push(
          step({
            ...base,
            kind: 'chaiInCycle',
            rank: RANK.contribution,
            label: 'Tea paid at the desk',
            detail: 'Already inside the week’s automatic tea — it does not move the figure above.',
            effect: false,
          })
        );
      } else {
        // Tea collected off the paper ledger, before these books opened. This one is real money off
        // his balance: the engine adds it to the tea it deducts.
        steps.push(
          step({
            ...base,
            kind: 'chaiBefore',
            rank: RANK.contribution,
            label: 'Tea — collected before these books opened',
            detail,
            out: cash,
            effect: true,
          })
        );
      }
    } else if (c.isGroupFund) {
      // A group fund: real income for the group, never this member's money — the same sentence the
      // passbook prints under such a row.
      steps.push(
        step({
          ...base,
          kind: 'groupFund',
          rank: RANK.contribution,
          label: `${c.typeName || 'Group fund'} — group fund`,
          detail: 'Money for the group, not counted in what he holds.',
          effect: false,
        })
      );
    } else {
      // His own money under a fund that is not the weekly cycle (welfare, for instance). Listed,
      // and named as outside the weekly figure, because the figure the engine arrives at follows
      // the weekly contribution and what he pays above it.
      steps.push(
        step({
          ...base,
          kind: 'otherPersonal',
          rank: RANK.contribution,
          label: `${c.typeName || 'Contribution'} — outside the weekly cycle`,
          detail: 'Recorded against him; the money held above follows the weekly contributions.',
          effect: false,
        })
      );
    }
  }


  // Tea, week by week, on the Thursday that closed the week — the day after which the engine counts
  // it. The week still running is not here: its Thursday is still to come, which is what keeps an
  // empty book reading zero. Twelve weeks are listed one by one and the older ones rolled into a
  // single line, so a long cycle cannot push the rest of the walk off the page.
  const teaWeeks = [];
  for (let w = cycleStartWeek + 1; w <= cycleStartWeek + scored; w++) {
    teaWeeks.push({
      weekNumber: w,
      date: weekRange(w, config).endDate,
      amount: toMoney(config.chaiAmount),
    });
  }
  if (teaWeeks.length > 0 && toNumber(config.chaiAmount) > 0) {
    const rolled = teaWeeks.length > WEEKS_SHOWN ? teaWeeks.slice(0, teaWeeks.length - WEEKS_SHOWN) : [];
    for (const w of teaWeeks.slice(-WEEKS_SHOWN)) {
      steps.push(
        step({
          id: `tea:${w.weekNumber}`,
          kind: 'teaWeek',
          rank: RANK.teaWeek,
          date: w.date,
          weekNumber: w.weekNumber,
          label: `Tea — week ${w.weekNumber} closed`,
          detail: `${money(w.amount)} a week, deducted automatically and paid into the Group’s Tea Fund.`,
          out: w.amount,
          effect: true,
        })
      );
    }
    if (rolled.length > 0) {
      steps.push(
        step({
          id: `tea:${rolled[0].weekNumber}-${rolled[rolled.length - 1].weekNumber}`,
          kind: 'teaWeek',
          rank: RANK.teaWeek,
          date: rolled[rolled.length - 1].date,
          weekNumber: rolled[rolled.length - 1].weekNumber,
          label: `Tea — weeks ${rolled[0].weekNumber} to ${rolled[rolled.length - 1].weekNumber} (${rolled.length} weeks)`,
          detail: `${money(config.chaiAmount)} a week, deducted automatically and paid into the Group’s Tea Fund.`,
          out: toMoney(rolled.reduce((sum, w) => sum + w.amount, 0)),
          effect: true,
        })
      );
    }
  }

  // The fines, on their own line: charged on the day the fine was issued, less every payment
  // against it. The column ends on what is still owed — the figure the passbook prints as
  // "outstanding fines".
  for (const fine of fineList(fines)) {
    const id = String(fine._id || `${fine.date}-${toNumber(fine.amount)}`);
    steps.push(
      step({
        id: `fine:${id}`,
        kind: 'fineIssued',
        rank: RANK.fineIssued,
        date: fine.date,
        label: `Fine — ${fineName(fine)}`,
        detail: fine.reason || null,
        owedIn: toNumber(fine.amount),
        effect: false,
      })
    );
    fineSettlements(fine).forEach((settlement, index) => {
      steps.push(
        step({
          id: `fine:${id}:${index}`,
          kind: 'fineSettled',
          rank: RANK.fineSettled,
          date: settlement.date,
          label: `Fine cleared — ${fineName(fine)}`,
          detail: settlement.contributionId
            ? 'Paid out of a contribution of his.'
            : 'Recorded by the office.',
          owedOut: toNumber(settlement.amount),
          effect: false,
        })
      );
    });
  }

  // In date order, with two deliberate exceptions. The carried-in line always opens the walk,
  // whatever the dates say: it is the baseline the rest is counted from, and tea collected before the
  // cycle (which the engine takes off that very figure) carries an earlier date than the opening week
  // does. After that, steps sharing a day are read money-first — the payment, then the fine it
  // cleared.
  const leadsTheWalk = (s) => (s.rank === RANK.opening ? -1 : 0);
  steps.sort(
    (a, b) => leadsTheWalk(a) - leadsTheWalk(b) || timeOf(a.date) - timeOf(b.date) || a.rank - b.rank
  );

  // Two running figures, then, and never one: what the group holds for him, and what he still owes
  // in fines. Every step carries both, so a row can be read on its own without the reader adding up
  // the column above it.
  let held = 0;
  let owed = 0;
  let moneyIn = 0;
  let moneyOut = 0;
  let teaOff = 0;
  for (const s of steps) {
    held = toMoney(held + s.in - s.out);
    owed = toMoney(owed + s.owedIn - s.owedOut);
    moneyIn = toMoney(moneyIn + s.in);
    moneyOut = toMoney(moneyOut + s.out);
    if (s.kind === 'teaWeek' || s.kind === 'chaiBefore') teaOff = toMoney(teaOff + s.out);
    s.held = held;
    s.owed = owed;
  }

  // What the fines still say he owes, taken from the fines themselves rather than from the walk:
  // the two are meant to be the same number, and `balanced` is where that is checked.
  const finesRecorded = toMoney(fineList(fines).reduce((sum, fine) => sum + fineRemaining(fine), 0));

  return {
    openingBalance,
    cycleStartWeek,
    currentWeek,
    weeklyAmount: toMoney(config.weeklyAmount),
    teaPerWeek: toMoney(config.chaiAmount),
    steps,
    totals: {
      // The whole in column, opening balance included, so a screen can print the sum the same
      // way the figures are read: carried in + paid in − tea = held.
      moneyIn,
      moneyOut,
      // Its two halves, named, because "paid in since the books opened" and "what he carried in"
      // are different questions and the office asks both.
      opening: openingBalance,
      paidIn: toMoney(moneyIn - openingBalance),
      // Not on the held column, so it is named on its own: every week's automatic tea and any
      // tea collected before the cycle, added up.
      teaOff,
    },
    closing: {
      // What this walk arrives at, beside the engine's own figure for the same two questions.
      held,
      money: toMoney(ledger.money),
      finesOwed: owed,
      finesRecorded,
      arrears: toMoney(ledger.arrears),
      weeksBehind: ledger.weeksBehind,
      weeksClosed: ledger.weeksScored,
      required: toMoney(ledger.required),
    },
    // Whether the working adds up to the figure at the top of the page, fines included. The screens
    // print the closing line only when it does.
    balanced: held === toMoney(ledger.money) && owed === finesRecorded,
  };
}

module.exports = { buildLedgerWalk, WEEKS_SHOWN };
