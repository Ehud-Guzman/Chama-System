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
// with them: "money held" (carried in, plus what he has paid, less what was due) and "paid in his own
// name" (the rows, added up) are different questions, and a passbook that answers the second while
// looking like it answered the first is how a member comes to believe he has money he does not.
export function passbookPosition(ledger, fallbackTotal = 0) {
  if (!ledger) {
    return {
      label: 'Paid in his own name',
      held: Number(fallbackTotal) || 0,
      identity: null,
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
    identity:
      `${money(ledger.openingBalance)} carried in + ${money(ledger.paid)} paid in since week `
      + `${ledger.cycleStartWeek} − ${money((Number(ledger.required) || 0) + (Number(ledger.tea) || 0))} `
      + 'due so far (weekly contributions and tea)',
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
