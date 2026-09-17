const mongoose = require('mongoose');
const Contribution = require('../models/Contribution');
const Expense = require('../models/Expense');

// Balance for a fund: money in minus money out. `extraIncome` covers income the
// ledger derives rather than reads from a contribution row — today that is the
// Tea Fund, whose 100 a week is deducted from every member automatically (§7.2),
// so it has no contribution rows of its own to sum.
async function fundBalance(typeId, { extraIncome = 0 } = {}) {
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
  const totalContributed = (contributed[0]?.total || 0) + Number(extraIncome || 0);
  const totalExpenses = spent[0]?.total || 0;
  return { totalContributed, totalExpenses, balance: totalContributed - totalExpenses };
}

module.exports = { fundBalance };
