const Contribution = require('../models/Contribution');
const Expense = require('../models/Expense');
const ContributionType = require('../models/ContributionType');
const Member = require('../models/Member');
const { carriedInTotals } = require('./carriedIn');
const { fundBalance } = require('./fundBalance');
const { bucketForType } = require('./ledgerTypes');
const { resolveConfig, scoredWeeks } = require('./weekCycle');
const { getOrCreateSettings } = require('./settings');

// The group's money, in the three lines a committee asks for: what came in, what has
// been spent out of the funds, and what that leaves on hand.
//
// This is deliberately the only place that arithmetic is written down. Two screens
// need it — the reports summary, which prints the position under the totals, and the
// expenses screen with its report, whose whole point is that spending is deducted
// from what was contributed — and two copies of it would disagree the first time one
// of them was changed. `totalContributed` is an ALL-TIME figure: it carries the money
// that was on the books before this ledger opened (each member's verified paper
// balance and each fund's float, utils/carriedIn), because a total summed from
// contribution rows alone reads as if the group had never collected anything.
async function computeMoneyPosition() {
  const [contributedRows, expensesAgg, carried, settings, activeMembers] = await Promise.all([
    Contribution.aggregate([
      { $match: { deleted: false } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    // Loans and advances (a type flagged isRecoverable) are left out on purpose:
    // money paid out under them is still owed back to the group, and counting it as
    // spent would make the group look like it had run a deficit the day it helped a
    // member. Everything else — tea, water, an emergency — is money gone.
    Expense.aggregate([
      { $match: { deleted: false } },
      { $group: { _id: '$typeId', total: { $sum: '$amount' } } },
      { $lookup: { from: 'contributiontypes', localField: '_id', foreignField: '_id', as: 'type' } },
      { $unwind: '$type' },
      { $match: { 'type.isRecoverable': { $ne: true } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    carriedInTotals(),
    getOrCreateSettings(),
    Member.countDocuments({ active: true }),
  ]);

  // What each fund holds, worked out the way the ledger works it out — with the Tea
  // Fund's automatic income included, because this is the office's copy and a fund
  // list that disagrees with the ledger is worse than none.
  const config = resolveConfig(settings);
  const fundTypes = await ContributionType.find()
    .select('name isGroupFund tracksExpenses isRecoverable openingBalance active')
    .lean();

  const chaiType = fundTypes.find((t) => bucketForType(t) === 'chai') || null;
  // Tea collected before the cycle started has no week to sit in, so it is summed
  // straight off the rows it was logged on.
  const teaBeforeCycle = chaiType
    ? await Contribution.aggregate([
        { $match: { deleted: false, typeId: chaiType._id, date: { $lt: config.anchorDate } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$grossAmount', '$amount'] } } } },
      ])
    : [];
  const teaIncome =
    config.chaiAmount * scoredWeeks(config) * activeMembers + (teaBeforeCycle[0]?.total || 0);

  const funds = await Promise.all(
    fundTypes
      .filter((t) => t.active !== false && (t.isGroupFund || t.tracksExpenses))
      .map(async (t) => {
        const derived = bucketForType(t) === 'chai' ? teaIncome : 0;
        const balance = await fundBalance(t._id, {
          carriedIn: t.openingBalance,
          extraIncome: derived,
        });
        return {
          // The type's own id, so a caller can key a fund picker on it.
          typeId: t._id,
          name: t.name,
          tracksExpenses: Boolean(t.tracksExpenses),
          // A fund whose payouts are loans or advances: its spending is listed but is
          // not part of the deducted total, because the money is still owed back.
          isRecoverable: Boolean(t.isRecoverable),
          // The part of the balance the ledger derives rather than reads from a row
          // — today only the automatic tea — so a list can name it.
          derived,
          ...balance,
          // fundBalance() folds the carry-in and the derived income into
          // totalContributed, so what actually came in as logged rows has to be named
          // separately for a screen that shows its work.
          collected: balance.totalContributed - balance.carriedIn - derived,
          spent: balance.totalExpenses,
        };
      })
  );

  const collected = contributedRows[0]?.total || 0;
  const totalContributed = collected + carried.total;
  const totalExpenses = expensesAgg[0]?.total || 0;

  return {
    carriedIn: carried,
    collected,
    totalContributed,
    totalExpenses,
    netBalance: totalContributed - totalExpenses,
    funds,
    teaIncome,
  };
}

module.exports = { computeMoneyPosition };
