const mongoose = require('mongoose');
const Contribution = require('../models/Contribution');
const Expense = require('../models/Expense');

// Balance for a tracksExpenses fund (e.g. Chai) = contributions collected
// minus expenses logged against the same ContributionType.
async function fundBalance(typeId) {
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
  const totalContributed = contributed[0]?.total || 0;
  const totalExpenses = spent[0]?.total || 0;
  return { totalContributed, totalExpenses, balance: totalContributed - totalExpenses };
}

module.exports = { fundBalance };
