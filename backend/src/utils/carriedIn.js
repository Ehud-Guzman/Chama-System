const Member = require('../models/Member');
const ContributionType = require('../models/ContributionType');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The money that was already on the books the day this ledger opened.
//
// Two piles, disjoint by construction: each member's verified paper-ledger
// balance (Member.openingBalance, which the reset writes from his own rows only —
// group funds excluded) and each fund's one-time carry-in
// (ContributionType.openingBalance: the tea float, registration money already
// collected). Between them they are what the group held before the cycle.
//
// Any "all time" figure needs them. A total summed from contribution rows alone
// answers a different question — "what has this ledger watched come in?" — and
// after go-live the two are far apart: Ksh 44,800 of rows against Ksh 3.4M the
// members actually hold. A figure labelled all-time that reads only the rows
// tells every member their years of contributions never happened.
async function carriedInTotals() {
  const [members, funds] = await Promise.all([
    Member.aggregate([{ $group: { _id: null, total: { $sum: { $ifNull: ['$openingBalance', 0] } } } }]),
    ContributionType.aggregate([
      { $group: { _id: null, total: { $sum: { $ifNull: ['$openingBalance', 0] } } } },
    ]),
  ]);
  const memberBalances = round2(members[0]?.total);
  const fundFloats = round2(funds[0]?.total);
  return { memberBalances, fundFloats, total: round2(memberBalances + fundFloats) };
}

module.exports = { carriedInTotals };
