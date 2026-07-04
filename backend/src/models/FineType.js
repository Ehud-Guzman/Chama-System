const { Schema, model } = require('mongoose');

const FineTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    active: { type: Boolean, default: true }, // soft-delete flag, same pattern as ContributionType
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = model('FineType', FineTypeSchema);
