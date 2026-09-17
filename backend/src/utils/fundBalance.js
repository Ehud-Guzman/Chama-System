const mongoose = require('mongoose');
const Contribution = require('../models/Contribution');
const Expense = require('../models/Expense');

// Balance for a fund: what it already held when the books opened, plus money in,
// minus money out.
//
// `extraIncome` covers income the ledger derives rather than reads from a
// contribution row — today that is the Tea Fund, whose 100 a week is deducted
// from every member automatically (§7.2), so it has no contribution rows of its
// own to sum.
//
// `carriedIn` is the fund's one-time opening total from the go-live screen: the
// money that was already in it — the tea float, registration collected so far —
// before this ledger started counting. Without it every fund would read as if the
// group had never collected anything, which is the same trap the members' opening
// balances exist to avoid.
async function fundBalance(typeId, { extraIncome = 0, carriedIn = 0 } = {}) {
  // Aggregation pipelines don't auto-cast query args like Mongoose finders do —
  // a bare string typeId here would silently match nothing.
  const id = new mongoose.Types.ObjectId(typeId);
  const [contributed, spent] = await Promise.all([
    Contribution.aggregate([
      { $match: { typeId: id, deleted: false } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Expense.aggregate([
      { $match: { typeId: id, deleted: false } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);
  const carried = Number(carriedIn) || 0;
  const totalContributed = carried + (contributed[0]?.total || 0) + Number(extraIncome || 0);
  const totalExpenses = spent[0]?.total || 0;
  return { carriedIn: carried, totalContributed, totalExpenses, balance: totalContributed - totalExpenses };
}

module.exports = { fundBalance };
