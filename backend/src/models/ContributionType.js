const { Schema, model } = require('mongoose');

const ContributionTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    active: { type: Boolean, default: true }, // soft-delete flag, same pattern as Member
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // Fixed recurring due (e.g. the 1,400 weekly contribution, the 100 Chai fee),
    // driving the per-week schedule instead of/alongside per-member pledges.
    isWeekly: { type: Boolean, default: false },
    weeklyAmount: { type: Number, default: 0 },
    // Marks a fund (e.g. Chai) whose balance = contributions minus logged expenses.
    tracksExpenses: { type: Boolean, default: false },
    // Marks a shared/group fund (e.g. Chai) — money collected under this type
    // belongs to the group, not the individual, so it's excluded from every
    // member's personal "total contributed" figure even though it's still
    // logged on their ledger.
    isGroupFund: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = model('ContributionType', ContributionTypeSchema);
