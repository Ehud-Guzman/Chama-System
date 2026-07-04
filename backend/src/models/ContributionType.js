const { Schema, model } = require('mongoose');

const ContributionTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    active: { type: Boolean, default: true }, // soft-delete flag, same pattern as Member
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = model('ContributionType', ContributionTypeSchema);
