// The extension is explicit because Node's resolver needs one and Vite does not — the same rule
// services/api.js follows so its module can be imported by `node --test`.
import { money } from './format.js';

// Where a member stands, in the words his own passbook uses.
//
// This is the first thing he reads on the page — what he holds, where that figure comes from, and
// whether he is behind — so it is the one part of the passbook whose wording is worth pinning down.
// Pure, and free of React: the card renders what this returns, and the test checks the sentences and
// the figures without a browser.
//
// `ledger` is the cycle engine's answer (utils/memberLedger on the server). `fallbackTotal` is what
// the rows against the member add up to, used only when there is no ledger at all — an older record,
// or one the cycle cannot place. The two are NOT interchangeable, which is why the label changes
// with them: "money held" (carried in, plus what he has paid, less the tea the group took) and "paid
// in his own name" (the rows, added up) are different questions, and a passbook that answers the
// second while looking like it answered the first is how a member comes to believe he has money he
// does not.
//
// A week that closed and was not paid is deliberately NOT folded into the held figure: it is the
// money he still owes, so it rides on its own line (`arrearsText`) and the figure at the top keeps
// meaning "what the group is holding for him".
export function passbookPosition(ledger, fallbackTotal = 0) {
  if (!ledger) {
    return {
      label: 'Paid in his own name',
      held: Number(fallbackTotal) || 0,
      identity: null,
      // Not a figure the engine gave, so nothing is claimed about it.
      netOfDues: null,
      arrears: 0,
      weeksBehind: 0,
      upToDate: false,
      arrearsText: null,
    };
  }

  const arrears = Number(ledger.arrears) || 0;
  const weeksBehind = Number(ledger.weeksBehind) || 0;

  return {
    label: `Money held · week ${ledger.currentWeek}`,
    held: Number(ledger.money) || 0,
    // The sum behind the figure, spelled out. Without it the number at the top of the card is a
    // number nobody can check against anything.
    //
    // Only money that actually came in is subtracted here. A week that closed and was not paid is
    // the "owed" line below, not a deduction from what the group is holding — the two questions the
    // paper ledger's total column kept apart too.
    identity:
      `${money(ledger.openingBalance)} carried in + ${money(ledger.paid)} paid in since week `
      + `${ledger.cycleStartWeek} − ${money(Number(ledger.tea) || 0)} tea deducted (Group fund)`,
    // What the figure read while the week's expectation was still being taken off it
    // (`held − weeks that have closed`). Kept because members and the office both hold older
    // statements, and "it has already happened" is answerable with a subtraction rather than an
    // argument: the money held did not change, only what is shown as owing beside it.
    netOfDues: Number(ledger.moneyNetOfDues) || 0,
    arrears,
    weeksBehind,
    upToDate: arrears <= 0,
    // "Owed" on its own invites the next question — how far back? — so the weeks ride with it, and
    // one week is not "1 weeks behind".
    arrearsText:
      arrears > 0
        ? `${money(arrears)} owed${
            weeksBehind > 0 ? ` (${weeksBehind} week${weeksBehind === 1 ? '' : 's'} behind)` : ''
          }`
        : null,
  };
}
