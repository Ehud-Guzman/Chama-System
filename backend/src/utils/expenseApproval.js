// The spending limit: no expenditure above a set amount without the members' prior approval,
// recorded in the minutes.
//
// The group sets the figure (Settings -> Spending limit), and 0 means the check is off, which is
// what it is until somebody sets one. Above it, an expense must say which minute or resolution
// approved it, in a box of its own (`approvalRef`), separate from the voucher or receipt number
// that says what the money was paid against. This does not decide whether the approval was real; it
// makes sure somebody wrote down which one it was, so it can be found in the minutes and argued in
// a meeting.
const money = (n) => `Ksh ${Number(n || 0).toLocaleString('en-KE')}`;

const MIN_REF_LENGTH = 2;

// The refusal for an expense that needs an approval and has none, or null when it is fine.
function approvalProblem({ amount, approvalRef, limit }) {
  const cap = Number(limit) || 0;
  if (cap <= 0 || !(Number(amount) > cap)) return null;
  if (String(approvalRef || '').trim().length >= MIN_REF_LENGTH) return null;
  return {
    status: 400,
    body: {
      message:
        `Spending above ${money(cap)} needs the members\u2019 approval in the minutes. ` +
        'Write the number or date of the minute that approved it in the \u201cApproved in\u201d box.',
      needsApproval: true,
      limit: cap,
    },
  };
}

module.exports = { approvalProblem, MIN_REF_LENGTH };
