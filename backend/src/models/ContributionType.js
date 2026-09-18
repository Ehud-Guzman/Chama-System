const { Schema, model } = require('mongoose');

const ContributionTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    active: { type: Boolean, default: true }, // soft-delete flag, same pattern as Member
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // Fixed recurring due (e.g. the 1,400 weekly contribution, the 100 Chai fee),
    // driving the per-week schedule the whole cycle is scored against.
    isWeekly: { type: Boolean, default: false },
    weeklyAmount: { type: Number, default: 0 },
    // Marks a fund (e.g. Chai) whose balance = contributions minus logged expenses.
    tracksExpenses: { type: Boolean, default: false },
    // Marks a shared/group fund (e.g. Chai) — money collected under this type
    // belongs to the group, not the individual, so it's excluded from every
    // member's personal "total contributed" figure even though it's still
    // logged on their ledger.
    isGroupFund: { type: Boolean, default: false },
    // Money paid out under this type is a loan/advance, not spent — it's still
// owed back to the group. Excluded from "total expenses" so outstanding
// loans don't make the group look like it's run a deficit.
isRecoverable: { type: Boolean, default: false },
    // What the fund already held when the books opened — the same one-time
    // carry-in a member gets in `openingBalance`, entered on the go-live screen.
    // The Tea Fund's float, registration money collected before this ledger, and
    // so on. A fund's balance is this, plus what comes in, minus what goes out.
    openingBalance: { type: Number, default: 0 },
    // Where the carried-in figure came from (the paper book's column, a bank
    // line, …), so a figure nobody can account for is visible as unexplained.
    openingBalanceNote: { type: String, default: '' },
  },
  
  { timestamps: true }
);


module.exports = model('ContributionType', ContributionTypeSchema);
