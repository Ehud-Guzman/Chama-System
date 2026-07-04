const { Schema, model } = require('mongoose');

// One pledge per member per contribution type — admin edits the amount rather
// than creating new rows. The unique index enforces that at the DB level.
const PledgeSchema = new Schema(
  {
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    typeId: { type: Schema.Types.ObjectId, ref: 'ContributionType', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    setBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

PledgeSchema.index({ memberId: 1, typeId: 1 }, { unique: true });

module.exports = model('Pledge', PledgeSchema);
